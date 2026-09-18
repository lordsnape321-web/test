import { db } from "@/db";
import { teams, tournamentPayments, tournamentTeams, tournaments, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { sendNotification } from "@/lib/notify";
import {
  TEAM_APPROVED,
  TEAM_PENDING_STATUSES,
  approvalCheck,
  depositFor,
  paymentState,
  refundFor,
} from "@/lib/league";
import { recalcTeamTotals } from "@/lib/league-store";
import { formatNPR } from "@/lib/futsal";
import { ONLINE_PAYMENTS } from "@/lib/loyalty";
import {
  buildEsewaFields,
  getEsewaConfig,
  getAppOrigin,
  getKhaltiConfig,
  khaltiInitiate,
  makeLeagueEsewaUuid,
  makeLeagueKhaltiOrder,
} from "@/lib/payments";

export const dynamic = "force-dynamic";

const PAY_METHODS = ["eSewa", "Khalti", "Cash at Venue"];

/**
 * GET /api/tournaments/[id]/payments — the league ledger 📒
 *
 * The host sees every row (that's their bookkeeping). A captain sees their own
 * squad's rows plus the summary line, because "how much have we paid and what
 * comes back if we quit?" is a question a captain is entitled to answer exactly.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leagueId = Number(id);
    if (!Number.isInteger(leagueId) || leagueId <= 0)
      return Response.json({ payments: [], error: "Invalid league 🛡️" }, { status: 400 });

    const { searchParams } = new URL(req.url);
    const userId = Number(searchParams.get("userId") ?? 0) || 0;

    const league = (await db.select().from(tournaments).where(eq(tournaments.id, leagueId)))[0];
    if (!league) return Response.json({ payments: [], error: "League not found 🛡️" }, { status: 404 });

    const all = (await db.select().from(tournamentPayments).where(eq(tournamentPayments.tournamentId, leagueId)))
      .sort((a, b) => (b.createdAt?.getTime?.() ?? 0) - (a.createdAt?.getTime?.() ?? 0));

    const allTeams = await db.select().from(teams);
    const memberships = await db.select().from(tournamentTeams).where(eq(tournamentTeams.tournamentId, leagueId));

    const myTeamIds =
      userId > 0
        ? memberships
            .filter((m) => allTeams.find((t) => t.id === m.teamId)?.captainId === userId)
            .map((m) => m.teamId)
        : [];

    const isHost = league.hostId === userId;
    const rows = isHost ? all : all.filter((p) => myTeamIds.includes(p.teamId));

    const squads = memberships
      .filter((m) => isHost || myTeamIds.includes(m.teamId))
      .map((m) => ({
        teamId: m.teamId,
        teamName: allTeams.find((t) => t.id === m.teamId)?.name ?? "Squad",
        status: m.status,
        paidAmount: m.paidAmount,
        refundedAmount: m.refundedAmount,
        payment: paymentState({
          entryFee: league.entryFee,
          paidAmount: m.paidAmount,
          refundedAmount: m.refundedAmount,
          depositPercent: league.depositPercent,
          refundPercent: league.refundPercent,
          status: m.status,
        }),
      }));

    return Response.json({
      payments: rows.map((p) => ({
        id: p.id,
        teamId: p.teamId,
        teamName: allTeams.find((t) => t.id === p.teamId)?.name ?? "Squad",
        kind: p.kind,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        recordedBy: p.recordedBy,
        createdAt: p.createdAt,
      })),
      squads,
      totals: {
        collected: rows.filter((p) => p.kind === "entry").reduce((s, p) => s + p.amount, 0),
        refunded: rows.filter((p) => p.kind === "refund").reduce((s, p) => s + p.amount, 0),
        prizePool: league.prizePool,
        deposit: depositFor(league.entryFee, league.depositPercent),
        entryFee: league.entryFee,
      },
      isHost,
    });
  } catch (e) {
    console.error(`[/api/tournaments/[id]/payments GET] failed:`, e);
    return Response.json({ payments: [], error: String(e) }, { status: 500 });
  }
}

/**
 * POST /api/tournaments/[id]/payments — money moves 💸
 *
 * Three actions:
 *
 * - `pay`    — a captain settles the entry fee (or any part of it). Paying at
 *              least the deposit is what *locks the place*: an invited squad
 *              becomes an approved one the moment the money lands, and a squad
 *              that merely asked is marked ready so the host can approve with
 *              one tap.
 * - `record` — the host enters cash handed over at the ground. The deposit rule
 *              can't be allowed to block a league where everybody pays the
 *              host in person, so this counts exactly like an online payment.
 * - `prize`  — the host pays the winner out of the pool at the end.
 *
 * Payments are simulated (the same test-gateway spirit as the rest of the app):
 * no card is charged, but every row of the ledger is real, dated and attributed.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const leagueId = Number(id);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    if (!Number.isInteger(leagueId) || leagueId <= 0)
      return Response.json({ error: "Invalid league 🛡️" }, { status: 400 });

    const league = (await db.select().from(tournaments).where(eq(tournaments.id, leagueId)))[0];
    if (!league) return Response.json({ error: "That league no longer exists 🛡️" }, { status: 404 });

    const teamId = Number(body.teamId);
    const team = (await db.select().from(teams).where(eq(teams.id, teamId)))[0];
    if (!team) return Response.json({ error: "Pick a squad first 🛡️" }, { status: 404 });

    const row = (
      await db
        .select()
        .from(tournamentTeams)
        .where(
          and(eq(tournamentTeams.tournamentId, leagueId), eq(tournamentTeams.teamId, teamId))
        )
    )[0];
    if (!row)
      return Response.json(
        { error: "That squad isn't on this league's list yet — request or get invited first 📨" },
        { status: 404 }
      );
    if (row.status === "withdrawn")
      return Response.json(
        { error: `${team.name} withdrew from this league — re-enter before paying 🏳️` },
        { status: 409 }
      );

    const hostLink = `/leagues/${leagueId}`;
    const host = (await db.select().from(users).where(eq(users.id, league.hostId)))[0];
    const captain = (await db.select().from(users).where(eq(users.id, team.captainId)))[0];
    const deposit = depositFor(league.entryFee, league.depositPercent);

    /* ------------------------------------------------------------- pay */
    if (action === "pay") {
      const userId = Number(body.userId);
      if (team.captainId !== userId)
        return Response.json(
          { error: `Only ${captain?.name ?? "the captain"} can pay the entry fee for ${team.name} 👑` },
          { status: 403 }
        );
      if (league.entryFee <= 0)
        return Response.json({ error: "This league is free to enter — nothing to pay 🎟️" }, { status: 400 });

      const method = String(body.method ?? "");
      if (!PAY_METHODS.includes(method))
        return Response.json({ error: `Pay by ${PAY_METHODS.join(", ")} 💳` }, { status: 400 });

      const due = Math.max(0, league.entryFee - row.paidAmount);
      const amount = Math.floor(Number(body.amount ?? due));
      if (!Number.isFinite(amount) || amount <= 0)
        return Response.json({ error: "Enter the amount you're paying 💰" }, { status: 400 });
      if (amount > due)
        return Response.json(
          { error: `You only have ${formatNPR(due)} left to pay on this entry 🙂` },
          { status: 400 }
        );
      // The first instalment has to clear the deposit, otherwise the "at least
      // 25% up front" promise means nothing. Later instalments are free-form.
      const isFirst = row.paidAmount <= 0;
      if (isFirst && amount < deposit)
        return Response.json(
          {
            error: `The first payment has to be at least the deposit — ${formatNPR(deposit)} (${league.depositPercent}% of ${formatNPR(league.entryFee)}). That's what holds ${team.name}'s place.`,
            reason: "deposit_required",
          },
          { status: 400 }
        );
      if (!ONLINE_PAYMENTS.includes(method))
        return Response.json(
          { error: "Cash is recorded by the host when they receive it — pay online here, or hand it over and ask them to mark it 💵" },
          { status: 400 }
        );

      await db.insert(tournamentPayments).values({
        tournamentId: leagueId,
        teamId,
        userId,
        kind: "entry",
        amount,
        method,
        reference: String(body.reference ?? "").slice(0, 120),
        recordedBy: userId,
      });
      // The medium they paid by and any screenshot they attached live on the
      // entry, which is where the host goes looking for proof.
      const receipt = String(body.receiptUrl ?? "").slice(0, 2000000);
      await db
        .update(tournamentTeams)
        .set({
          payMethod: method,
          ...(receipt ? { receiptUrl: receipt } : {}),
          updatedAt: new Date(),
        })
        .where(eq(tournamentTeams.id, row.id));
      const totals = await recalcTeamTotals(leagueId, teamId);
      const state = paymentState({
        entryFee: league.entryFee,
        paidAmount: totals.paidAmount,
        refundedAmount: totals.refundedAmount,
        depositPercent: league.depositPercent,
        refundPercent: league.refundPercent,
      });

      // An invitation *is* accepted by paying: the host already said yes, and
      // the money is the captain's yes. A request still needs the host's tap.
      let approved = false;
      if (state.depositMet && row.status === "invited") {
        await db
          .update(tournamentTeams)
          .set({ status: TEAM_APPROVED, decidedBy: userId, decidedAt: new Date(), updatedAt: new Date() })
          .where(eq(tournamentTeams.id, row.id));
        approved = true;
      }

      await sendNotification({
        userId: league.hostId,
        type: "league",
        title: `💰 ${formatNPR(amount)} from ${team.name}`,
        message: `${captain?.name ?? "The captain"} paid ${method} towards ${league.name} — ${formatNPR(totals.paidAmount)} of ${formatNPR(league.entryFee)} in. ${state.depositMet ? (state.due > 0 ? `Deposit cleared, ${formatNPR(state.due)} to go.` : "Entry fee fully settled 🎉") : `${formatNPR(state.deposit - state.paid)} short of the deposit, so the place isn't locked yet.`}${approved ? " Their invite is now accepted." : ""}`,
        link: hostLink,
      });

      return Response.json({
        ok: true,
        approved,
        paidAmount: totals.paidAmount,
        depositMet: state.depositMet,
        message: approved
          ? `Paid — and you're in! ${formatNPR(totals.paidAmount)} of ${formatNPR(league.entryFee)} settled 🎉`
          : state.due > 0
            ? `Paid ${formatNPR(amount)} — ${formatNPR(state.due)} left on the entry fee ✅`
            : `Entry fee fully paid — all ${formatNPR(totals.paidAmount)} of it 💯`,
      });
    }

    /* ---------------------------------------------------------- record */
    if (action === "record") {
      const hostId = Number(body.hostId);
      if (league.hostId !== hostId)
        return Response.json({ error: "Only the host can record payments 👑" }, { status: 403 });

      const method = PAY_METHODS.includes(String(body.method)) ? String(body.method) : "Cash at Venue";
      const amount = Math.floor(Number(body.amount ?? 0));
      if (!Number.isFinite(amount) || amount <= 0)
        return Response.json({ error: "How much did you take? Enter an amount 💵" }, { status: 400 });
      // Same ceiling as a captain paying themselves: the entry fee, minus
      // whatever this squad has already paid. A host counting cash at the door
      // shouldn't be able to key in four thousand on a two thousand entry —
      // the ledger would say the squad overpaid and the refund maths would
      // follow it down.
      const owed = Math.max(0, league.entryFee - row.paidAmount);
      if (amount > owed)
        return Response.json(
          {
            error:
              owed <= 0
                ? `${team.name} has already settled the whole ${formatNPR(league.entryFee)} entry fee — there's nothing left to record ✅`
                : `${team.name} only owes ${formatNPR(owed)} — the entry fee is ${formatNPR(league.entryFee)} and they've paid ${formatNPR(row.paidAmount)} 🙂`,
          },
          { status: 400 }
        );

      await db.insert(tournamentPayments).values({
        tournamentId: leagueId,
        teamId,
        userId: team.captainId,
        kind: "entry",
        amount,
        method,
        reference: String(body.reference ?? "").slice(0, 120) || "Recorded by host",
        recordedBy: hostId,
      });
      const totals = await recalcTeamTotals(leagueId, teamId);
      const state = paymentState({
        entryFee: league.entryFee,
        paidAmount: totals.paidAmount,
        depositPercent: league.depositPercent,
      });

      await sendNotification({
        userId: team.captainId,
        type: "league",
        title: `🧾 ${formatNPR(amount)} recorded for ${team.name}`,
        message: `${host?.name ?? "The host"} marked your ${method} payment on ${league.name}. ${state.depositMet ? (state.due > 0 ? `${formatNPR(state.due)} remains on the entry fee.` : "Entry fee settled in full 🎉") : `${formatNPR(state.deposit - state.paid)} still needed to clear the deposit.`}`,
        link: hostLink,
      });

      return Response.json({
        ok: true,
        paidAmount: totals.paidAmount,
        depositMet: state.depositMet,
        message: `${formatNPR(amount)} recorded for ${team.name} ✅`,
      });
    }

    /* -------------------------------------------------------- initiate */
    /**
     * Hand the captain a checkout for the medium they picked 🧾
     *
     * Same shape as the booking gateways, because it *is* the same money: eSewa
     * comes back as a form to post (url + signed fields) plus the local
     * simulator link, Khalti as a payment_url to redirect to. The reference
     * carries league + squad, so a callback can find its way back here.
     */
    if (action === "initiate") {
      const userId = Number(body.userId);
      if (team.captainId !== userId)
        return Response.json(
          { error: `Only ${captain?.name ?? "the captain"} can pay the entry fee for ${team.name} 👑` },
          { status: 403 }
        );
      if (league.entryFee <= 0)
        return Response.json({ error: "This league is free to enter — nothing to pay 🎟️" }, { status: 400 });

      const method = String(body.method ?? "");
      if (!ONLINE_PAYMENTS.includes(method))
        return Response.json(
          { error: "Pick eSewa or Khalti to pay online — cash is recorded by the host when they take it 💵" },
          { status: 400 }
        );

      const due = Math.max(0, league.entryFee - row.paidAmount);
      if (due <= 0)
        return Response.json({ error: "This entry fee is already settled ✅" }, { status: 400 });
      const amount = Math.min(Math.floor(Number(body.amount ?? due)), due);
      if (!Number.isFinite(amount) || amount <= 0)
        return Response.json({ error: "Enter the amount you're paying 💰" }, { status: 400 });
      if (amount > due)
        return Response.json(
          { error: `You only have ${formatNPR(due)} left to pay on this entry 🙂` },
          { status: 400 }
        );

      const origin = getAppOrigin(req.url, req);
      const backTo = `${origin}/leagues/${leagueId}`;

      if (method === "eSewa") {
        const cfg = getEsewaConfig();
        const transactionUuid = makeLeagueEsewaUuid(leagueId, teamId);
        await db
          .update(tournamentTeams)
          .set({ payMethod: method, gatewayTxnId: "", updatedAt: new Date() })
          .where(eq(tournamentTeams.id, row.id));
        const fields = buildEsewaFields({
          amount,
          transactionUuid,
          productCode: cfg.productCode,
          secretKey: cfg.secretKey,
          successUrl: backTo,
          failureUrl: backTo,
        });
        return Response.json({
          url: cfg.formUrl,
          fields,
          amount,
          transactionUuid,
          testMode: true,
          mockUrl: `${origin}/payment/esewa/mock?leagueId=${leagueId}&teamId=${teamId}&userId=${userId}&amount=${amount}&uuid=${encodeURIComponent(transactionUuid)}`,
          testHint: "eSewa UAT: ID 9806800001 / password 123456 / MPIN 1122 / token 123456",
        });
      }

      // Khalti — with the same "no key, or the sandbox is unreachable, so use
      // the simulator" fallback the booking route has.
      const cfg = getKhaltiConfig();
      const orderId = makeLeagueKhaltiOrder(leagueId, teamId);
      await db
        .update(tournamentTeams)
        .set({ payMethod: method, gatewayTxnId: "", updatedAt: new Date() })
        .where(eq(tournamentTeams.id, row.id));
      const mockUrl = `${origin}/payment/khalti/mock?leagueId=${leagueId}&teamId=${teamId}&userId=${userId}&amount=${amount}&pidx=${encodeURIComponent(`mock-${orderId}`)}`;
      if (!cfg.secretKey) {
        return Response.json({
          mock: true,
          pidx: `mock-${orderId}`,
          payment_url: mockUrl,
          amount,
          orderId,
          testHint: "Sandbox simulator — no KHALTI_SECRET_KEY set.",
        });
      }
      try {
        const init = await khaltiInitiate({
          secretKey: cfg.secretKey,
          initiateUrl: cfg.initiateUrl,
          returnUrl: backTo,
          websiteUrl: origin,
          amountPaisa: amount * 100,
          orderId,
          orderName: `${league.name} — entry fee`,
          customerName: captain?.name ?? team.name,
          customerEmail: captain?.email ?? "player@futsal.np",
          customerPhone: captain?.phone ?? "9800000000",
        });
        return Response.json({ mock: false, pidx: init.pidx, payment_url: init.payment_url, amount, orderId });
      } catch {
        return Response.json({
          mock: true,
          pidx: `mock-${orderId}`,
          payment_url: mockUrl,
          amount,
          orderId,
          testHint: "Khalti sandbox unreachable — falling back to the local simulator.",
        });
      }
    }

    /* ---------------------------------------------------------- verify */
    /**
     * The checkout came back approved ✅
     *
     * This is where a league entry actually gets its money recorded — the same
     * ledger row, the same deposit rule and the same "paying accepts the
     * invite" behaviour as a captain paying directly.
     */
    if (action === "verify") {
      const userId = Number(body.userId);
      if (team.captainId !== userId)
        return Response.json({ error: "That's not your entry to pay for 👑" }, { status: 403 });
      if (body.mockApprove !== true)
        return Response.json({ error: "Nothing to verify yet 💳" }, { status: 400 });

      const due = Math.max(0, league.entryFee - row.paidAmount);
      if (due <= 0)
        return Response.json({ error: "This entry fee is already settled ✅" }, { status: 400 });
      const amount = Math.min(Math.floor(Number(body.amount ?? due)), due);
      const method = ONLINE_PAYMENTS.includes(String(body.method)) ? String(body.method) : "eSewa";
      const txn = `MOCK-${method.toUpperCase()}-${leagueId}-${teamId}-${Date.now().toString(36)}`.slice(0, 100);

      await db.insert(tournamentPayments).values({
        tournamentId: leagueId,
        teamId,
        userId,
        kind: "entry",
        amount,
        method,
        reference: `${method} checkout (txn ${txn})`.slice(0, 120),
        recordedBy: userId,
      });
      await db
        .update(tournamentTeams)
        .set({ payMethod: method, gatewayTxnId: txn, updatedAt: new Date() })
        .where(eq(tournamentTeams.id, row.id));

      const totals = await recalcTeamTotals(leagueId, teamId);
      const state = paymentState({
        entryFee: league.entryFee,
        paidAmount: totals.paidAmount,
        refundedAmount: totals.refundedAmount,
        depositPercent: league.depositPercent,
        refundPercent: league.refundPercent,
      });

      let approved = false;
      if (state.depositMet && row.status === "invited") {
        await db
          .update(tournamentTeams)
          .set({ status: TEAM_APPROVED, decidedBy: userId, decidedAt: new Date(), updatedAt: new Date() })
          .where(eq(tournamentTeams.id, row.id));
        approved = true;
      }

      await sendNotification({
        userId: league.hostId,
        type: "league",
        title: `💰 ${formatNPR(amount)} from ${team.name} via ${method}`,
        message: `${captain?.name ?? "The captain"} cleared ${formatNPR(amount)} on the ${league.name} entry fee through ${method} (txn ${txn}). ${formatNPR(totals.paidAmount)} of ${formatNPR(league.entryFee)} in — ${state.due > 0 ? `${formatNPR(state.due)} to go.` : "settled in full 🎉"}`,
        link: hostLink,
      });

      return Response.json({
        ok: true,
        approved,
        txn,
        paidAmount: totals.paidAmount,
        depositMet: state.depositMet,
        message: approved
          ? `Paid — and you're in! ${formatNPR(totals.paidAmount)} of ${formatNPR(league.entryFee)} settled 🎉`
          : `${formatNPR(amount)} received via ${method} ✅${state.due > 0 ? ` ${formatNPR(state.due)} left on the entry fee.` : ""}`,
      });
    }

    /* --------------------------------------------------------- receipt */
    /**
     * Attach the screenshot, without moving any money 🧾
     *
     * A captain who pays cash at the ground, or who already transferred from
     * the app, has proof the host can look at before approving. Booking a court
     * works the same way, so joining a league does too.
     */
    if (action === "receipt") {
      const userId = Number(body.userId);
      if (team.captainId !== userId)
        return Response.json({ error: "Only the captain can attach proof for this entry 👑" }, { status: 403 });
      const receipt = String(body.receiptUrl ?? "").slice(0, 2000000);
      await db
        .update(tournamentTeams)
        .set({
          receiptUrl: receipt,
          ...(body.payMethod && PAY_METHODS.includes(String(body.payMethod))
            ? { payMethod: String(body.payMethod) }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(tournamentTeams.id, row.id));
      if (receipt) {
        await sendNotification({
          userId: league.hostId,
          type: "league",
          title: `🧾 Payment proof from ${team.name}`,
          message: `${captain?.name ?? "The captain"} attached a payment screenshot for their ${league.name} entry — worth a look before you approve.`,
          link: hostLink,
        });
      }
      return Response.json({
        ok: true,
        message: receipt
          ? "Screenshot attached — the host can see it now 🧾"
          : "Screenshot removed.",
      });
    }

    /* ----------------------------------------------------------- prize */
    if (action === "prize") {
      const hostId = Number(body.hostId);
      if (league.hostId !== hostId)
        return Response.json({ error: "Only the host pays out the pool 👑" }, { status: 403 });
      const amount = Math.floor(Number(body.amount ?? 0));
      if (!Number.isFinite(amount) || amount <= 0)
        return Response.json({ error: "Enter the prize amount 🏆" }, { status: 400 });

      await db.insert(tournamentPayments).values({
        tournamentId: leagueId,
        teamId,
        userId: team.captainId,
        kind: "prize",
        amount,
        method: String(body.method ?? "Prize payout"),
        reference: String(body.reference ?? "").slice(0, 120) || "Prize",
        recordedBy: hostId,
      });

      await sendNotification({
        userId: team.captainId,
        type: "league",
        title: `🏆 Prize paid — ${formatNPR(amount)}!`,
        message: `${host?.name ?? "The host"} paid out ${formatNPR(amount)} to ${team.name} from the ${league.name} pool. Congratulations! 🎉`,
        link: hostLink,
      });

      return Response.json({ ok: true, message: `${formatNPR(amount)} prize recorded 🏆` });
    }

    return Response.json(
      { error: "Unknown action — try pay, record or prize 💸" },
      { status: 400 }
    );
  } catch (e) {
    console.error(`[/api/tournaments/[id]/payments POST] failed:`, e);
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
