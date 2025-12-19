// Gmail API OAuth and Client Service

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";

// Required scopes for reading emails
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export interface GmailTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenExpiry: Date;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  snippet?: string;
}

export interface EmailDetails {
  id: string;
  threadId: string;
  snippet: string;
  subject: string;
  from: string;
  to: string;
  date: Date;
  body: string;
  bodyHtml?: string;
}

function getClientId(): string {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) {
    throw new Error("GMAIL_CLIENT_ID environment variable is not set");
  }
  return clientId;
}

function getClientSecret(): string {
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;
  if (!clientSecret) {
    throw new Error("GMAIL_CLIENT_SECRET environment variable is not set");
  }
  return clientSecret;
}

function getRedirectUri(): string {
  return process.env.GMAIL_REDIRECT_URI || "http://localhost:5000/api/gmail/callback";
}

/**
 * Generate the Google OAuth consent URL
 */
export function getAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // Force consent to get refresh token
  });

  if (state) {
    params.set("state", state);
  }

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<GmailTokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: getRedirectUri(),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to exchange code for tokens: ${errorText}`);
  }

  const data = await response.json();

  if (!data.refresh_token) {
    throw new Error("No refresh token received. User may need to revoke access and re-authorize.");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenExpiry: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Refresh an expired access token
 */
export async function refreshAccessToken(refreshToken: string): Promise<GmailTokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to refresh access token: ${errorText}`);
  }

  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: refreshToken, // Keep the original refresh token
    expiresIn: data.expires_in,
    tokenExpiry: new Date(Date.now() + data.expires_in * 1000),
  };
}

/**
 * Get the user's email address from Google
 */
export async function getUserEmail(accessToken: string): Promise<string> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("Failed to get user email");
  }

  const data = await response.json();
  return data.email;
}

/**
 * List emails matching a query
 */
export async function getEmailList(
  accessToken: string,
  query: string,
  maxResults = 50
): Promise<EmailMessage[]> {
  const params = new URLSearchParams({
    q: query,
    maxResults: maxResults.toString(),
  });

  const response = await fetch(`${GMAIL_API_BASE}/users/me/messages?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list emails: ${errorText}`);
  }

  const data = await response.json();
  return data.messages || [];
}

/**
 * Get full email content by message ID
 */
export async function getEmailContent(
  accessToken: string,
  messageId: string
): Promise<EmailDetails> {
  const response = await fetch(`${GMAIL_API_BASE}/users/me/messages/${messageId}?format=full`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get email content: ${errorText}`);
  }

  const data = await response.json();

  // Extract headers
  const headers = data.payload?.headers || [];
  const getHeader = (name: string): string => {
    const header = headers.find((h: { name: string; value: string }) =>
      h.name.toLowerCase() === name.toLowerCase()
    );
    return header?.value || "";
  };

  // Extract body
  let body = "";
  let bodyHtml = "";

  const extractBody = (part: any): void => {
    if (part.mimeType === "text/plain" && part.body?.data) {
      body = Buffer.from(part.body.data, "base64").toString("utf-8");
    } else if (part.mimeType === "text/html" && part.body?.data) {
      bodyHtml = Buffer.from(part.body.data, "base64").toString("utf-8");
    } else if (part.parts) {
      for (const subPart of part.parts) {
        extractBody(subPart);
      }
    }
  };

  if (data.payload) {
    extractBody(data.payload);
  }

  // If no plain text body found but HTML exists, extract text from HTML
  if (!body && bodyHtml) {
    body = bodyHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  // Parse date
  const dateStr = getHeader("Date");
  let date: Date;
  try {
    date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      date = new Date(parseInt(data.internalDate));
    }
  } catch {
    date = new Date(parseInt(data.internalDate));
  }

  return {
    id: data.id,
    threadId: data.threadId,
    snippet: data.snippet || "",
    subject: getHeader("Subject"),
    from: getHeader("From"),
    to: getHeader("To"),
    date,
    body,
    bodyHtml,
  };
}

/**
 * Check if credentials are configured
 */
export function isGmailConfigured(): boolean {
  try {
    getClientId();
    getClientSecret();
    return true;
  } catch {
    return false;
  }
}
