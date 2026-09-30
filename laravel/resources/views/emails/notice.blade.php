{{--
    Every email the app sends, in the app's own colours.

    One template rather than a dozen near-identical ones: a heading, a few
    paragraphs, an optional big code (password resets), an optional details table
    (booking reminders) and an optional button back into the app.

    Email clients are not browsers — the layout is a table, the CSS is inline and
    the only "modern" touches are a media query for phones and a hidden preheader
    (the grey line the inbox shows next to the subject).
--}}
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>{{ $heading }}</title>
<style>
  /* The one bit of CSS Gmail keeps: keeping the card readable on a phone. */
  @media only screen and (max-width: 600px) {
    .wrap { width: 100% !important; }
    .pad { padding: 22px !important; }
    .h1 { font-size: 22px !important; line-height: 28px !important; }
    .code { font-size: 30px !important; letter-spacing: 6px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#FFF9F0;">
  <div style="display:none;font-size:1px;color:#FFF9F0;max-height:0;overflow:hidden;">{{ $preheader }}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FFF9F0;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" class="wrap" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background-color:#FFFFFF;border:1px solid #F0E3CC;border-radius:24px;overflow:hidden;">

          <tr>
            <td class="pad" style="padding:26px 28px 18px 28px;background-color:#047857;background-image:linear-gradient(135deg,#047857,#166534);">
              <div style="font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#A7F3D0;">
                {{ $appName }}
              </div>
              @if (! empty($eyebrow))
                <div style="margin-top:6px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;color:#D1FAE5;">
                  {{ $eyebrow }}
                </div>
              @endif
              <div class="h1" style="margin-top:10px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:25px;line-height:32px;font-weight:800;color:#FFFFFF;">
                {{ $heading }}
              </div>
            </td>
          </tr>

          <tr>
            <td class="pad" style="padding:24px 28px 8px 28px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:23px;color:#1C1917;">
              @if (! empty($recipient))
                <p style="margin:0 0 10px 0;">Hi {{ $recipient }},</p>
              @endif

              @foreach ((array) $intro as $paragraph)
                @if (trim((string) $paragraph) !== '')
                  <p style="margin:0 0 12px 0;">{{ $paragraph }}</p>
                @endif
              @endforeach

              @if (! empty($code))
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 8px 0;">
                  <tr>
                    <td align="center" style="background-color:#ECFDF5;border:1px dashed #6EE7B7;border-radius:16px;padding:18px 12px;">
                      <div class="code" style="font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:34px;line-height:40px;font-weight:800;letter-spacing:8px;color:#065F46;">
                        {{ $code }}
                      </div>
                      <div style="margin-top:6px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;color:#047857;">
                        Your reset code
                      </div>
                    </td>
                  </tr>
                </table>
              @endif

              @if (! empty($rows))
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px 0;border:1px solid #F0E3CC;border-radius:16px;">
                  @foreach ($rows as $label => $value)
                    <tr>
                      <td style="padding:10px 14px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:13px;color:#78716C;border-bottom:1px solid #F5EBDA;white-space:nowrap;">
                        {{ $label }}
                      </td>
                      <td style="padding:10px 14px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:#1C1917;border-bottom:1px solid #F5EBDA;">
                        {{ $value }}
                      </td>
                    </tr>
                  @endforeach
                </table>
              @endif

              @if (! empty($cta) && ! empty($cta['label']) && ! empty($cta['url']))
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:20px 0 6px 0;">
                  <tr>
                    <td align="center" style="background-color:#047857;border-radius:14px;">
                      <a href="{{ $cta['url'] }}" style="display:inline-block;padding:13px 22px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:800;color:#FFFFFF;text-decoration:none;">
                        {{ $cta['label'] }}
                      </a>
                    </td>
                  </tr>
                </table>
              @endif

              @if (! empty($footnote))
                <p style="margin:14px 0 0 0;font-size:13px;line-height:20px;color:#78716C;">{{ $footnote }}</p>
              @endif
            </td>
          </tr>

          <tr>
            <td class="pad" style="padding:18px 28px 24px 28px;">
              <div style="border-top:1px solid #F0E3CC;padding-top:14px;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:19px;color:#78716C;">
                You are getting this because you have a {{ $appName }} account.
                Change what we email you any time in the app: <strong>Settings → Alerts → Email</strong>.
                <br />
                See you on the turf ⚽
              </div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
