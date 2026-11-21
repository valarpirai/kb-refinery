/** Sample content for local development. Deliberately imperfect so the pipeline has defects to find. */

export const articles = [
  {
    externalId: "KB0001",
    title: "Reset your VPN password",
    knowledgeBase: "IT Support",
    format: "md" as const,
    body: `# Reset your VPN password

This must be done from the corporate network or the self-service portal.

1. Open the portal.
2. Click **Forgot password**.
3. Enter your employee ID. It will send a code to your phone.
4. Enter the code and choose a new password.

See the previous article for password rules.`,
  },
  {
    externalId: "KB0002",
    title: "Configure MFA for Okta",
    knowledgeBase: "Identity",
    format: "html" as const,
    body: `<h1>Configure MFA</h1>
<p>MFA is required for all staff. Install Okta Verify first.</p>
<div style="font-size:14px"><span>Open Okta Verify and tap <b>Add account</b>.</span></div>
<p>Scan the QR code shown in the screenshot below.</p>
<img src="https://example.com/mfa-qr.png" alt="">
<p>For help see <a href="https://example.com/old-mfa-page">click here</a>.</p>`,
  },
  {
    externalId: "KB0003",
    title: "Outlook keeps asking for credentials",
    knowledgeBase: "Email",
    format: "md" as const,
    body: `# Outlook keeps asking for credentials

Outlook prompts repeatedly after a password change.

Try restarting Outlook. If that fails, remove the cached credentials from Windows Credential Manager and sign in again.`,
  },
  {
    externalId: "KB0004",
    title: "Request a new laptop",
    knowledgeBase: "Hardware",
    format: "md" as const,
    body: `# Request a new laptop

Laptops are refreshed every 3 years. Submit a request in the service catalog under **Hardware > Laptop**.

Your manager must approve it. Delivery takes 5 business days. Windows 10 images are available on request.`,
  },
  {
    externalId: "KB0005",
    title: "Reset the VPN password (self service)",
    knowledgeBase: "IT Support",
    format: "md" as const,
    body: `# Reset the VPN password (self service)

Use the self-service portal to reset a forgotten VPN password.

1. Open the self-service portal.
2. Select **Forgot password**.
3. Enter your employee ID and the code sent to your phone.
4. Choose a new password.`,
  },
  {
    externalId: "KB0006",
    title: "Slack is slow on Wi-Fi",
    knowledgeBase: "Collaboration",
    format: "html" as const,
    body: `<h2>Slack is slow</h2><p>If Slack lags, check your connection. Clear the cache from <code>Help &gt; Troubleshooting</code>.</p>`,
  },
];

export const incidents = [
  { number: "INC0010001", shortDescription: "VPN password reset code not received", description: "User never received the SMS code during VPN password reset.", resolution: "Phone number was outdated in the directory. Updated it and re-sent the code. Codes expire after 10 minutes." },
  { number: "INC0010002", shortDescription: "Cannot reset VPN password off-network", description: "Self-service reset page was unreachable from home.", resolution: "Reset works off-network through the public portal URL, not only from the corporate network." },
  { number: "INC0010003", shortDescription: "Okta Verify QR code will not scan", description: "Camera permission denied on iOS.", resolution: "Enable camera access for Okta Verify in iOS Settings, then retry." },
  { number: "INC0010004", shortDescription: "Okta MFA enrolment fails on Android 14", description: "Enrolment loops at the final step.", resolution: "Update Okta Verify to the latest version, then re-enrol." },
  { number: "INC0010005", shortDescription: "Outlook credential prompt loop", description: "Prompt returns after every sign-in.", resolution: "Delete MicrosoftOffice16 entries in Credential Manager and sign in again; also disable the stale cached profile." },
  { number: "INC0010006", shortDescription: "Outlook asks for password after MFA change", description: "Modern auth token invalid after MFA reset.", resolution: "Sign out of all Office apps and sign in again to refresh the token." },
  { number: "INC0010007", shortDescription: "Laptop request rejected: wrong cost centre", description: "Request needs a valid cost centre.", resolution: "Enter the cost centre in the request form. Windows 11 is the standard image; Windows 10 is no longer supported." },
  { number: "INC0010008", shortDescription: "Slack calls drop on guest Wi-Fi", description: "Guest network blocks UDP.", resolution: "Use the corporate network or the wired dock for Slack calls." },
];

export const products = [
  { name: "VPN", aliases: "GlobalProtect,Corporate VPN", type: "internal" as const },
  { name: "Okta", aliases: "Okta Verify,Okta MFA", type: "vendor" as const },
  { name: "Outlook", aliases: "Microsoft Outlook", type: "external" as const },
  { name: "Windows", aliases: "Windows 10,Windows 11", type: "platform" as const },
  { name: "Slack", aliases: "", type: "external" as const },
  { name: "Self-service portal", aliases: "SSP", type: "internal" as const },
];
