// Shared email shell: table layout and inline styles only, because most mail clients drop <style> blocks and flexbox.
// Colours mirror the light "ink and paper" tokens of the design spec (§2.1); emails have no dark-mode switch.

const COLORS = Object.freeze({
  page: "#f3f1ec",
  card: "#ffffff",
  ink: "#1b1a18",
  onInk: "#f3f1ec",
  muted: "#5e5b55",
  line: "#e4e1da",
});

const FONT = "'IBM Plex Sans', -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'IBM Plex Mono', SFMono-Regular, Menlo, Consolas, monospace";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

function paragraph(html) {
  return `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:24px;color:${COLORS.ink};">${html}</p>`;
}

function button({ label, url }) {
  const href = escapeHtml(url);
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr>
    <td bgcolor="${COLORS.ink}" style="border-radius:12px;">
      <a href="${href}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;color:${COLORS.onInk};text-decoration:none;border-radius:12px;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

function fallbackLink(url) {
  const href = escapeHtml(url);
  return `
<p style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:20px;color:${COLORS.muted};">If the button does not work, copy this link into your browser:</p>
<p style="margin:0 0 24px;font-family:${MONO};font-size:12px;line-height:18px;word-break:break-all;"><a href="${href}" target="_blank" rel="noopener" style="color:${COLORS.ink};text-decoration:underline;">${href}</a></p>`;
}

// paragraphs and notes are trusted HTML built by the templates; anything user-supplied must be escaped before it gets here.
export function renderLayout({ preheader, heading, paragraphs, action, notes = [] }) {
  const year = new Date().getUTCFullYear();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLORS.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.page}">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">
        <tr>
          <td style="padding:0 4px 20px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td width="40" height="40" align="center" valign="middle" bgcolor="${COLORS.ink}" style="width:40px;height:40px;border-radius:12px;font-family:'Noto Sans Tamil',${FONT};font-size:20px;line-height:40px;color:${COLORS.onInk};">&#2965;</td>
                <td style="padding-left:12px;font-family:${FONT};font-size:16px;font-weight:600;color:${COLORS.ink};">Kanaku Pillai</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td bgcolor="${COLORS.card}" style="padding:32px 28px 12px;border:1px solid ${COLORS.line};border-radius:20px;">
            <h1 style="margin:0 0 16px;font-family:${FONT};font-size:22px;line-height:30px;font-weight:600;color:${COLORS.ink};">${escapeHtml(heading)}</h1>
            ${paragraphs.map(paragraph).join("\n")}
            ${action ? button(action) + fallbackLink(action.url) : ""}
            ${notes
              .map(
                (note) =>
                  `<p style="margin:0 0 16px;font-family:${FONT};font-size:13px;line-height:20px;color:${COLORS.muted};">${note}</p>`,
              )
              .join("\n")}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 4px 0;font-family:${FONT};font-size:12px;line-height:18px;color:${COLORS.muted};">
            This is an automated message from Kanaku Pillai. Replies to this address are not read.<br>
            &copy; ${year} Kanaku Pillai
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

// Plain-text part for clients that do not render HTML (and for spam filters, which prefer both).
export function renderText({ heading, lines, action, notes = [] }) {
  const parts = [heading, "", ...lines, ""];
  if (action) parts.push(`${action.label}:`, action.url, "");
  parts.push(
    ...notes,
    "",
    "-- ",
    "Kanaku Pillai. This is an automated message; replies are not read.",
  );
  return parts.join("\n");
}
