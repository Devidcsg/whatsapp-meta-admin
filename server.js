import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;

const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_CONFIG_ID = process.env.META_CONFIG_ID;
const GRAPH_API_VERSION = process.env.GRAPH_API_VERSION || "v25.0";

// For WhatsApp Business App coexistence onboarding
const META_FEATURE_TYPE =
  process.env.META_FEATURE_TYPE || "whatsapp_business_app_onboarding";

const ADMIN_SETUP_KEY = process.env.ADMIN_SETUP_KEY;
const WEBHOOK_VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;

const SHOW_TOKEN_IN_ADMIN = process.env.SHOW_TOKEN_IN_ADMIN === "true";

const CONNECTED_FILE = path.join(__dirname, ".connected-whatsapp.json");

function requireEnv() {
  const missing = [];

  if (!META_APP_ID) missing.push("META_APP_ID");
  if (!META_APP_SECRET) missing.push("META_APP_SECRET");
  if (!META_CONFIG_ID) missing.push("META_CONFIG_ID");
  if (!ADMIN_SETUP_KEY) missing.push("ADMIN_SETUP_KEY");
  if (!WEBHOOK_VERIFY_TOKEN) missing.push("WEBHOOK_VERIFY_TOKEN");

  if (missing.length) {
    console.warn("Missing env variables:", missing.join(", "));
  }
}

requireEnv();

function requireAdmin(req, res, next) {
  const key =
    req.query.key ||
    req.headers["x-admin-key"] ||
    req.body?.adminKey ||
    "";

  if (!ADMIN_SETUP_KEY) {
    return res.status(500).json({
      ok: false,
      error: "ADMIN_SETUP_KEY is not configured in env",
    });
  }

  if (key !== ADMIN_SETUP_KEY) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized. Missing or invalid admin key.",
    });
  }

  next();
}

function maskToken(token = "") {
  if (!token || token.length < 16) return "hidden";
  return `${token.slice(0, 8)}...${token.slice(-8)}`;
}

function safeJsonForHtml(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function extractEmbeddedSignupIds(embeddedSignupData = {}) {
  const data =
    embeddedSignupData?.data ||
    embeddedSignupData?.payload ||
    embeddedSignupData ||
    {};

  const phoneNumberId =
    data.phone_number_id ||
    data.phoneNumberId ||
    data.business_phone_number_id ||
    data.businessPhoneNumberId ||
    data.phone_number?.id ||
    data.phoneNumber?.id ||
    null;

  const wabaId =
    data.waba_id ||
    data.wabaId ||
    data.whatsapp_business_account_id ||
    data.whatsappBusinessAccountId ||
    data.waba?.id ||
    data.whatsapp_business_account?.id ||
    null;

  const businessId =
    data.business_id ||
    data.businessId ||
    data.business?.id ||
    null;

  return {
    wabaId,
    phoneNumberId,
    businessId,
  };
}

function saveConnection(data) {
  fs.writeFileSync(CONNECTED_FILE, JSON.stringify(data, null, 2));
}

function readConnection() {
  if (!fs.existsSync(CONNECTED_FILE)) return null;

  try {
    return JSON.parse(fs.readFileSync(CONNECTED_FILE, "utf8"));
  } catch {
    return null;
  }
}

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html");

  res.send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>WhatsApp Meta Admin</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 820px; margin: 40px auto; line-height: 1.6;">
        <h1>WhatsApp Meta Admin backend is running</h1>

        <p>Open admin page:</p>
        <pre>GET /whatsapp-connect?key=YOUR_ADMIN_SETUP_KEY</pre>

        <p>Webhook:</p>
        <pre>GET/POST /webhook</pre>

        <p>Privacy policy:</p>
        <pre>GET /privacy-policy</pre>

        <p>Data deletion:</p>
        <pre>POST /data-deletion</pre>
      </body>
    </html>
  `);
});

/**
 * Admin page: WhatsApp Embedded Signup button
 */
app.get("/whatsapp-connect", requireAdmin, (req, res) => {
  const adminKey = req.query.key;

  const config = {
    appId: META_APP_ID,
    configId: META_CONFIG_ID,
    graphApiVersion: GRAPH_API_VERSION,
    adminKey,
    featureType: META_FEATURE_TYPE,
  };

  res.setHeader("Content-Type", "text/html");

  res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Connect WhatsApp Business</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />

  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 880px;
      margin: 40px auto;
      padding: 0 18px;
      line-height: 1.5;
      color: #111827;
    }

    .card {
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }

    button {
      background: #1877f2;
      color: white;
      border: none;
      border-radius: 8px;
      padding: 12px 18px;
      font-size: 16px;
      cursor: pointer;
    }

    button:hover {
      background: #145dbd;
    }

    code, pre {
      background: #f3f4f6;
      padding: 12px;
      border-radius: 8px;
      display: block;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .muted {
      color: #6b7280;
      font-size: 14px;
    }

    .success {
      color: #047857;
      font-weight: bold;
    }

    .error {
      color: #b91c1c;
      font-weight: bold;
    }
  </style>
</head>

<body>
  <div class="card">
    <h1>Connect WhatsApp Business</h1>

    <p>
      Use this page to run Meta Embedded Signup and connect a WhatsApp Business number to your API/webhook.
    </p>

    <p class="muted">
      Feature type: <strong>${META_FEATURE_TYPE}</strong>
    </p>

    <p class="muted">
      For coexistence, this should connect an existing WhatsApp Business App number.
    </p>

    <button onclick="launchWhatsAppSignup()">
      Connect WhatsApp Business
    </button>
  </div>

  <div class="card">
    <h2>Status</h2>
    <div id="status">Waiting...</div>
  </div>

  <div class="card">
    <h2>Embedded Signup Event</h2>
    <pre id="eventBox">No event yet.</pre>
  </div>

  <div class="card">
    <h2>Backend Result</h2>
    <pre id="resultBox">No result yet.</pre>
  </div>

  <script>
    const META_CONFIG = ${safeJsonForHtml(config)};
    let embeddedSignupData = null;

    function setStatus(message, type = "") {
      const el = document.getElementById("status");
      el.className = type;
      el.textContent = message;
    }

    function printEvent(data) {
      document.getElementById("eventBox").textContent =
        JSON.stringify(data, null, 2);
    }

    function printResult(data) {
      document.getElementById("resultBox").textContent =
        JSON.stringify(data, null, 2);
    }

    window.fbAsyncInit = function () {
      FB.init({
        appId: META_CONFIG.appId,
        cookie: true,
        xfbml: true,
        version: META_CONFIG.graphApiVersion
      });

      setStatus("Facebook SDK loaded. Ready to connect.", "success");
    };

    (function (d, s, id) {
      let js;
      const fjs = d.getElementsByTagName(s)[0];

      if (d.getElementById(id)) return;

      js = d.createElement(s);
      js.id = id;
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      fjs.parentNode.insertBefore(js, fjs);
    })(document, "script", "facebook-jssdk");

    window.addEventListener("message", function (event) {
      if (
        event.origin !== "https://www.facebook.com" &&
        event.origin !== "https://web.facebook.com"
      ) {
        return;
      }

      try {
        const data = JSON.parse(event.data);

        if (data.type === "WA_EMBEDDED_SIGNUP") {
          embeddedSignupData = data;
          printEvent(data);

          if (data.event === "FINISH") {
            setStatus("Embedded Signup completed. Waiting for code exchange...", "success");
          } else if (data.event === "CANCEL") {
            setStatus("Embedded Signup cancelled.", "error");
          } else if (data.event === "ERROR") {
            setStatus("Embedded Signup returned an error.", "error");
          }
        }
      } catch (err) {
        // Ignore non-JSON Meta messages.
      }
    });

    async function sendCodeToBackend(code, authResponse) {
      const response = await fetch("/api/meta/embedded-signup/exchange-code", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": META_CONFIG.adminKey
        },
        body: JSON.stringify({
          code,
          authResponse,
          embeddedSignupData
        })
      });

      const data = await response.json();
      printResult(data);

      if (data.ok) {
        setStatus("WhatsApp connected successfully. Save the returned IDs/tokens securely.", "success");
      } else {
        setStatus("Connection failed. Check Backend Result.", "error");
      }
    }

    function launchWhatsAppSignup() {
      setStatus("Opening Meta Embedded Signup...", "");

      FB.login(
        function (response) {
          console.log("FB.login response:", response);

          if (!response.authResponse) {
            setStatus("Signup cancelled or authorization failed.", "error");
            printResult(response);
            return;
          }

          const code = response.authResponse.code;

          if (!code) {
            setStatus("No exchange code returned by Meta.", "error");
            printResult(response);
            return;
          }

          setStatus("Code received. Exchanging with backend...", "success");

          sendCodeToBackend(code, response.authResponse).catch((err) => {
            console.error(err);
            setStatus("Backend exchange failed.", "error");
            printResult({
              ok: false,
              error: err.message
            });
          });
        },
        {
          config_id: META_CONFIG.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            feature: "whatsapp_embedded_signup",
            sessionInfoVersion: 3,
            featureType: META_CONFIG.featureType
          }
        }
      );
    }
  </script>
</body>
</html>`);
});

/**
 * Exchange Meta Embedded Signup code for token.
 */
app.post("/api/meta/embedded-signup/exchange-code", requireAdmin, async (req, res) => {
  try {
    const { code, embeddedSignupData, authResponse } = req.body;

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: "Missing code from Embedded Signup",
      });
    }

    if (!META_APP_ID || !META_APP_SECRET) {
      return res.status(500).json({
        ok: false,
        error: "META_APP_ID or META_APP_SECRET missing in env",
      });
    }

    const tokenResponse = await axios.get(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`,
      {
        params: {
          client_id: META_APP_ID,
          client_secret: META_APP_SECRET,
          code,
        },
      }
    );

    const accessToken = tokenResponse.data.access_token;
    const extracted = extractEmbeddedSignupIds(embeddedSignupData);

    let subscribeResult = null;
    let subscribeError = null;

    if (extracted.wabaId && accessToken) {
      try {
        const subscribeResponse = await axios.post(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/${extracted.wabaId}/subscribed_apps`,
          {},
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );

        subscribeResult = subscribeResponse.data;
      } catch (err) {
        subscribeError = err?.response?.data || err.message;
      }
    }

    const saved = {
      connectedAt: new Date().toISOString(),
      graphApiVersion: GRAPH_API_VERSION,

      wabaId: extracted.wabaId,
      phoneNumberId: extracted.phoneNumberId,
      businessId: extracted.businessId,

      accessToken,

      embeddedSignupData,
      authResponse,

      subscribeResult,
      subscribeError,
    };

    saveConnection(saved);

    return res.json({
      ok: true,
      message: "Embedded Signup code exchanged successfully.",

      wabaId: extracted.wabaId,
      phoneNumberId: extracted.phoneNumberId,
      businessId: extracted.businessId,

      accessToken: SHOW_TOKEN_IN_ADMIN ? accessToken : undefined,
      maskedAccessToken: maskToken(accessToken),

      subscribeResult,
      subscribeError,

      nextEnvValues: {
        GRAPH_API_TOKEN: SHOW_TOKEN_IN_ADMIN
          ? accessToken
          : "Hidden. Set SHOW_TOKEN_IN_ADMIN=true temporarily to view.",
        WHATSAPP_BUSINESS_ACCOUNT_ID: extracted.wabaId,
        PHONE_NUMBER_ID: extracted.phoneNumberId,
      },
    });
  } catch (err) {
    console.error(
      "Embedded Signup exchange error:",
      err?.response?.data || err.message
    );

    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message,
    });
  }
});

/**
 * Privacy Policy URL for Meta App Review.
 */
app.get("/privacy-policy", (_req, res) => {
  res.setHeader("Content-Type", "text/html");

  res.send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Privacy Policy - Inle Tech WhatsApp Meta Admin</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 820px; margin: 40px auto; line-height: 1.6;">
        <h1>Privacy Policy</h1>

        <p><strong>Last updated:</strong> 27 May 2026</p>

        <p>
          Inle Tech Pte Ltd provides WhatsApp Business API integration, webhook automation,
          and messaging support services for business clients.
        </p>

        <p>
          This application is used to connect customer-owned WhatsApp Business Accounts
          through Meta Embedded Signup and to support WhatsApp Business messaging workflows.
        </p>

        <h2>Information we collect</h2>
        <p>
          We may process Meta Business identifiers, WhatsApp Business Account IDs,
          phone number IDs, business IDs, webhook subscription status, WhatsApp message events,
          WhatsApp message status updates, profile names, phone numbers, and message content
          shared by users with the connected WhatsApp Business number.
        </p>

        <h2>How we use information</h2>
        <p>
          We use this information only to provide WhatsApp Business messaging services,
          including connecting WhatsApp Business Accounts, receiving webhook events,
          sending WhatsApp replies, supporting customer communication, dental inquiries,
          appointment requests, and operational support for our clients.
        </p>

        <h2>Data sharing</h2>
        <p>
          We do not sell user data. Data may be shared only with authorized client staff,
          service providers, hosting providers, or platforms required to operate WhatsApp
          Business messaging and the requested integration.
        </p>

        <h2>Data retention</h2>
        <p>
          We retain integration records and message-related records only as needed for
          service operation, support, compliance, troubleshooting, and service quality.
        </p>

        <h2>Data deletion</h2>
        <p>
          Users or businesses may request deletion by contacting us at admin@inle.tech
          or by using our data deletion endpoint.
        </p>

        <h2>Contact</h2>
        <p>
          For privacy-related requests, contact us at admin@inle.tech.
        </p>
      </body>
    </html>
  `);
});

/**
 * Facebook Login deauthorize callback.
 * Add this URL in Meta:
 * https://whatsapp-meta-admin.onrender.com/deauthorize
 */
app.post("/deauthorize", (req, res) => {
  console.log("Facebook deauthorize callback:");
  console.log(JSON.stringify(req.body, null, 2));

  return res.sendStatus(200);
});

/**
 * Facebook Data Deletion Request callback.
 * Add this URL in Meta:
 * https://whatsapp-meta-admin.onrender.com/data-deletion
 */
app.post("/data-deletion", (req, res) => {
  console.log("Facebook data deletion request:");
  console.log(JSON.stringify(req.body, null, 2));

  const confirmationCode = `delete_${Date.now()}`;

  return res.json({
    url: `${PUBLIC_BASE_URL}/data-deletion-status?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
});

app.get("/data-deletion", (_req, res) => {
  res.setHeader("Content-Type", "text/html");

  res.send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Data Deletion Request - Inle Tech</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 820px; margin: 40px auto; line-height: 1.6;">
        <h1>Data Deletion Request</h1>
        <p>
          To request deletion of data related to this WhatsApp integration,
          please email admin@inle.tech with your business name, WhatsApp Business Account ID,
          and the phone number connected to the service.
        </p>
      </body>
    </html>
  `);
});

app.get("/data-deletion-status", (req, res) => {
  const code = req.query.code || "not provided";

  res.setHeader("Content-Type", "text/html");

  res.send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Data Deletion Status - Inle Tech</title>
      </head>
      <body style="font-family: Arial, sans-serif; max-width: 820px; margin: 40px auto; line-height: 1.6;">
        <h1>Data Deletion Request Status</h1>

        <p>
          Your data deletion request has been received and will be processed.
        </p>

        <p>
          Confirmation code: <strong>${String(code)}</strong>
        </p>

        <p>
          Contact: admin@inle.tech
        </p>
      </body>
    </html>
  `);
});

/**
 * Check saved connection.
 */
app.get("/api/meta/connection", requireAdmin, (_req, res) => {
  const saved = readConnection();

  if (!saved) {
    return res.json({
      ok: false,
      message: "No saved WhatsApp connection found yet.",
    });
  }

  return res.json({
    ok: true,
    connectedAt: saved.connectedAt,
    wabaId: saved.wabaId,
    phoneNumberId: saved.phoneNumberId,
    businessId: saved.businessId,
    maskedAccessToken: maskToken(saved.accessToken),
    subscribeResult: saved.subscribeResult,
    subscribeError: saved.subscribeError,
  });
});

/**
 * WhatsApp webhook verification.
 */
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === WEBHOOK_VERIFY_TOKEN) {
    console.log("Webhook verified successfully.");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/**
 * WhatsApp webhook receiver.
 * Later you can replace this with your real bot logic.
 */
app.post("/webhook", (req, res) => {
  console.log("Incoming WhatsApp webhook:");
  console.log(JSON.stringify(req.body, null, 2));

  return res.sendStatus(200);
});

/**
 * Optional test sender.
 * Send a WhatsApp text message through connected API number.
 */
app.post("/api/whatsapp/send-test", requireAdmin, async (req, res) => {
  try {
    const saved = readConnection();

    const accessToken =
      req.body.accessToken ||
      process.env.GRAPH_API_TOKEN ||
      saved?.accessToken;

    const phoneNumberId =
      req.body.phoneNumberId ||
      process.env.PHONE_NUMBER_ID ||
      saved?.phoneNumberId;

    const to = String(req.body.to || "").replace(/\D/g, "");
    const body =
      req.body.body || "Test message from Inle Tech WhatsApp API backend.";

    if (!accessToken) {
      return res.status(400).json({
        ok: false,
        error: "Missing access token",
      });
    }

    if (!phoneNumberId) {
      return res.status(400).json({
        ok: false,
        error: "Missing phoneNumberId",
      });
    }

    if (!to) {
      return res.status(400).json({
        ok: false,
        error: "Missing recipient number in 'to'",
      });
    }

    const response = await axios.post(
      `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    return res.json({
      ok: true,
      data: response.data,
    });
  } catch (err) {
    console.error("Send test error:", err?.response?.data || err.message);

    return res.status(500).json({
      ok: false,
      error: err?.response?.data || err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`WhatsApp Meta Admin backend running on port ${PORT}`);
});