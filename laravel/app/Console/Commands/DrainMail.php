<?php

namespace App\Console\Commands;

use App\Services\Mailer;
use App\Services\MailPump;
use App\Support\GameReminders;
use Illuminate\Console\Command;

/**
 * Sends the queued mail — in its own process, off the request path.
 *
 * You should never need to run this: `MailPump` starts it automatically when
 * there is something in the outbox, which is what keeps `php artisan serve`
 * answering while Gmail is being slow. It is a normal command all the same, so
 * `php artisan mail:drain` will clear the backlog by hand if you ever want to
 * watch it happen.
 *
 * Two processes at once would double-send, so a non-blocking lock decides:
 * whoever gets it drains, everybody else goes home.
 */
class DrainMail extends Command
{
    protected $signature = 'mail:drain
        {--limit=50 : Most messages to send before exiting}
        {--budget=120 : Seconds of SMTP time to allow}
        {--retry-failed : Put parked (failed) messages back in the queue first}';

    protected $description = 'Send queued emails and due game reminders (normally started automatically)';

    public function handle(): int
    {
        $lock = MailPump::lock();

        if ($lock === null) {
            // Another drain is already doing this. Not an error — the caller is
            // a fire-and-forget spawn that nobody is watching.
            $this->line('Another drain is running.');

            return self::SUCCESS;
        }

        MailPump::claimRunning();

        try {
            $limit = max(1, (int) $this->option('limit'));
            $budget = max(1.0, (float) $this->option('budget'));

            if ($this->option('retry-failed')) {
                $requeued = Mailer::requeueFailed();

                if ($requeued > 0) {
                    $this->line("Requeued {$requeued} parked message(s).");
                }
            }

            // Reminders come first: they create mail, so doing them before the
            // flush means a reminder sent this run still goes out this run.
            $reminded = GameReminders::dispatch();
            $sent = Mailer::flush($limit, $budget);

            if ($reminded > 0 || $sent > 0) {
                $this->info("Reminded {$reminded} game(s); sent {$sent} email(s).");
            }
        } catch (\Throwable $e) {
            report($e);
            $this->error($e->getMessage());

            return self::FAILURE;
        } finally {
            MailPump::releaseRunning();
            MailPump::release($lock);
        }

        return self::SUCCESS;
    }
}
