// Email Parser for Supplier Order Emails

import type { EmailDetails } from "./gmail";
import type { SupplierOrderStatus } from "@shared/schema";

// Courier/Carrier domains - these are NOT suppliers, they deliver packages
// Emails from these domains should update existing orders, not create new ones
export const COURIER_DOMAINS = new Set([
  // US Carriers
  "ups.com",
  "fedex.com",
  "usps.com",
  "usps.gov",
  "dhl.com",
  "dhl.de",
  "ontrac.com",
  "lasership.com",

  // UK Carriers
  "royalmail.com",
  "royalmail.co.uk",
  "parcelforce.com",
  "parcelforce.co.uk",
  "dpd.co.uk",
  "dpd.com",
  "dpdlocal.co.uk",
  "evri.com",
  "hermes-europe.co.uk",
  "myhermes.co.uk",
  "apc-overnight.com",
  "apc-plc.com",
  "dxdelivery.com",
  "thedx.co.uk",
  "yodel.co.uk",
  "yodeldirect.co.uk",
  "ukmail.com",
  "collectplus.co.uk",
  "inpost.co.uk",
  "inpost.pl",

  // European/International
  "gls-group.eu",
  "gls-group.com",
  "tnt.com",
  "tnt.co.uk",
  "purolator.com",
  "canadapost.ca",
  "postnl.nl",
  "bpost.be",
  "laposte.fr",
  "deutschepost.de",
  "correos.es",
  "poste.it",

  // Logistics/Delivery platforms
  "track.aftership.com",
  "aftership.com",
  "ship24.com",
  "17track.net",
  "parcelsapp.com",
]);

/**
 * Check if an email domain belongs to a courier/carrier
 */
export function isCourierDomain(email: string): boolean {
  if (!email) return false;
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return false;
  const domain = email.substring(atIndex + 1).toLowerCase();
  return COURIER_DOMAINS.has(domain);
}

/**
 * Extract domain from email address
 */
export function extractDomainFromEmail(email: string): string | null {
  if (!email) return null;
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return null;
  return email.substring(atIndex + 1).toLowerCase();
}

export interface ParsedOrderData {
  supplierName: string | null;
  supplierEmail: string | null;
  orderNumber: string | null;
  orderDate: Date | null;
  expectedDeliveryDate: Date | null;
  trackingNumber: string | null;
  carrier: string | null;
  totalCost: string | null;
  currency: string;
  status: SupplierOrderStatus;
  items: ParsedOrderItem[];
}

export interface ParsedOrderItem {
  sku: string | null;
  asin: string | null;
  productName: string | null;
  quantity: number | null;
  unitCost: string | null;
}

// Order number patterns
const ORDER_NUMBER_PATTERNS = [
  /order\s*(?:#|number|no\.?|id)?[:\s]*([A-Z0-9][-A-Z0-9]{3,30})/i,
  /confirmation\s*(?:#|number|no\.?)?[:\s]*([A-Z0-9][-A-Z0-9]{3,30})/i,
  /(?:your\s+)?order\s+([A-Z0-9][-A-Z0-9]{5,20})\s+(?:has|is|was)/i,
  /order\s+reference[:\s]*([A-Z0-9][-A-Z0-9]{3,30})/i,
  /invoice\s*(?:#|number|no\.?)?[:\s]*([A-Z0-9][-A-Z0-9]{3,30})/i,
  /po\s*(?:#|number)?[:\s]*([A-Z0-9][-A-Z0-9]{3,30})/i,
];

// Tracking number patterns - more specific to avoid false positives
const TRACKING_PATTERNS = [
  // UPS: 1Z followed by 16 alphanumeric chars
  { pattern: /(1Z[A-Z0-9]{16})/i, carrier: "UPS" },
  // FedEx: 12, 15, 20, or 22 digits
  { pattern: /\b(\d{12})\b(?!\d)/, carrier: "FedEx" },
  { pattern: /\b(\d{15})\b(?!\d)/, carrier: "FedEx" },
  { pattern: /\b(\d{20})\b(?!\d)/, carrier: "FedEx" },
  { pattern: /\b(\d{22})\b(?!\d)/, carrier: "FedEx" },
  // USPS: 20-22 digits or specific formats
  { pattern: /\b(9[2-5]\d{20,22})\b/, carrier: "USPS" },
  { pattern: /\b(420\d{5}9[2-5]\d{20,22})\b/, carrier: "USPS" },
  // DHL: 10 or 11 digits (with DHL context) or JD followed by digits
  { pattern: /\b(\d{10,11})\b(?=.*dhl)/i, carrier: "DHL" },
  { pattern: /(JD\d{18})/i, carrier: "DHL" },
  // Amazon Logistics: TBA followed by digits
  { pattern: /(TBA\d{12,})/i, carrier: "Amazon" },

  // UK Carriers
  // Royal Mail: 2 letters + 9 digits + 2 letters (e.g., AA123456789GB)
  { pattern: /\b([A-Z]{2}\d{9}GB)\b/i, carrier: "Royal Mail" },
  // Royal Mail tracked 24/48: often starts with specific prefixes
  { pattern: /\b(JD\d{18})\b/i, carrier: "Royal Mail" },
  { pattern: /\b([A-Z]{2}\d{9}[A-Z]{2})\b(?=.*royal\s*mail)/i, carrier: "Royal Mail" },

  // Parcelforce: Various formats - often 2 letters + numbers + GB or just numbers
  { pattern: /\b([A-Z]{2}\d{7,9}GB)\b/i, carrier: "Parcelforce" },
  { pattern: /\b(P[A-Z]\d{9}GB)\b/i, carrier: "Parcelforce" },

  // DPD: Usually 14 digits or alphanumeric
  { pattern: /\b(\d{14})\b(?=.*dpd)/i, carrier: "DPD" },
  { pattern: /\b([0-9]{14})\b(?!\d)/, carrier: "DPD" },

  // Evri (formerly Hermes): Various formats, often starts with H or numeric
  { pattern: /(H[A-Z0-9]{15,})/i, carrier: "Evri" },
  { pattern: /\b(\d{16})\b(?=.*(?:evri|hermes))/i, carrier: "Evri" },

  // APC Overnight: Various alphanumeric formats
  { pattern: /\b([A-Z0-9]{10,20})\b(?=.*apc)/i, carrier: "APC" },

  // DX Express: Often starts with DX or alphanumeric
  { pattern: /(DX[A-Z0-9]{8,})/i, carrier: "DX" },
  { pattern: /\b([A-Z0-9]{10,15})\b(?=.*\bdx\b)/i, carrier: "DX" },

  // Yodel: Various formats
  { pattern: /(JD\d{16,})/i, carrier: "Yodel" },
  { pattern: /\b([A-Z0-9]{12,18})\b(?=.*yodel)/i, carrier: "Yodel" },

  // UKMail (now DHL Parcel UK)
  { pattern: /\b(\d{12,16})\b(?=.*ukmail)/i, carrier: "UKMail" },

  // Generic tracking with keyword context (fallback)
  { pattern: /tracking\s*(?:#|number|no\.?|id)?[:\s]*([A-Z0-9]{10,30})/i, carrier: null },
  { pattern: /track(?:ing)?\s+(?:your\s+)?(?:package|shipment|order)[:\s]*([A-Z0-9]{10,30})/i, carrier: null },
];

// Carrier detection patterns - expanded for more carriers including UK
const CARRIER_PATTERNS: Record<string, RegExp> = {
  // US Carriers
  UPS: /\bups\b|united\s+parcel|1Z[A-Z0-9]{16}/i,
  FedEx: /\bfedex\b|federal\s+express/i,
  USPS: /\busps\b|postal\s+service|united\s+states\s+postal|first[\s-]?class|priority\s+mail/i,
  DHL: /\bdhl\b|deutsche\s+post|dhl\s*express|dhl\s*parcel/i,
  Amazon: /\bamazon\s+logistics\b|amzl|TBA\d{12,}/i,
  OnTrac: /\bontrac\b/i,
  LaserShip: /\blasership\b/i,

  // UK Carriers
  "Royal Mail": /\broyal\s*mail\b|rm\s+tracked|special\s+delivery|signed\s+for/i,
  Parcelforce: /\bparcelforce\b|parcel\s*force/i,
  DPD: /\bdpd\b|dpd\s*local|dpd\s*uk/i,
  Evri: /\bevri\b|\bhermes\b|myhermes/i,
  APC: /\bapc\b|apc\s*overnight/i,
  DX: /\bdx\b|dx\s*express|dx\s*delivery/i,
  Yodel: /\byodel\b/i,
  UKMail: /\bukmail\b|uk\s*mail/i,
  "DHL Parcel UK": /\bdhl\s*parcel\s*uk\b/i,
  CollectPlus: /\bcollect\s*plus\b|\bcollect\+/i,
  InPost: /\binpost\b/i,

  // Other carriers
  GLS: /\bgls\b|general\s+logistics/i,
  Purolator: /\bpurolator\b/i,
  Canada_Post: /\bcanada\s+post\b/i,
  TNT: /\btnt\b|tnt\s*express/i,
};

// Date patterns
const DATE_PATTERNS = [
  // MM/DD/YYYY or MM-DD-YYYY
  /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/,
  // Month DD, YYYY
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})/i,
  // DD Month YYYY
  /(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4})/i,
  // YYYY-MM-DD (ISO)
  /(\d{4}-\d{2}-\d{2})/,
];

// Price patterns
const PRICE_PATTERNS = [
  /(?:total|amount|price|cost)[:\s]*\$?([\d,]+\.?\d{0,2})/i,
  /\$\s*([\d,]+\.\d{2})/,
  /(?:usd|gbp|eur)\s*([\d,]+\.?\d{0,2})/i,
];

// Email type detection keywords
const EMAIL_TYPE_KEYWORDS = {
  confirmation: [
    "order confirmed",
    "order confirmation",
    "thank you for your order",
    "we received your order",
    "order placed",
    "order received",
    "purchase confirmation",
  ],
  shipped: [
    "has shipped",
    "has been shipped",
    "is on its way",
    "order shipped",
    "shipment notification",
    "your package is on the way",
    "tracking number",
    "shipped!",
  ],
  delivered: [
    "has been delivered",
    "was delivered",
    "package delivered",
    "delivery confirmation",
    "successfully delivered",
  ],
  cancelled: [
    "order cancelled",
    "order canceled",
    "has been cancelled",
    "has been canceled",
    "cancellation confirmation",
  ],
  delayed: [
    "delayed",
    "backordered",
    "back ordered",
    "out of stock",
    "shipping delay",
  ],
};

/**
 * Detect the type of email and corresponding order status
 */
export function detectEmailType(
  subject: string,
  body: string
): SupplierOrderStatus {
  const text = `${subject} ${body}`.toLowerCase();

  // Check in priority order
  if (EMAIL_TYPE_KEYWORDS.delivered.some((kw) => text.includes(kw))) {
    return "delivered";
  }
  if (EMAIL_TYPE_KEYWORDS.cancelled.some((kw) => text.includes(kw))) {
    return "cancelled";
  }
  if (EMAIL_TYPE_KEYWORDS.shipped.some((kw) => text.includes(kw))) {
    return "shipped";
  }
  if (EMAIL_TYPE_KEYWORDS.delayed.some((kw) => text.includes(kw))) {
    return "issue";
  }
  if (EMAIL_TYPE_KEYWORDS.confirmation.some((kw) => text.includes(kw))) {
    return "confirmed";
  }

  return "pending";
}

/**
 * Extract supplier name from email sender
 */
export function extractSupplierName(from: string): string {
  // Format: "Company Name <email@example.com>" or just "email@example.com"
  const nameMatch = from.match(/^"?([^"<]+)"?\s*</);
  if (nameMatch) {
    return nameMatch[1].trim();
  }

  // Extract from email domain
  const emailMatch = from.match(/@([^.]+)\./);
  if (emailMatch) {
    // Capitalize first letter
    const domain = emailMatch[1];
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  }

  return from;
}

/**
 * Extract email address from sender string
 */
export function extractSupplierEmail(from: string): string | null {
  const emailMatch = from.match(/<([^>]+)>/) || from.match(/([^\s]+@[^\s]+)/);
  return emailMatch ? emailMatch[1] : null;
}

/**
 * Extract order number from email content
 */
export function extractOrderNumber(
  subject: string,
  body: string
): string | null {
  const text = `${subject}\n${body}`;

  for (const pattern of ORDER_NUMBER_PATTERNS) {
    const match = text.match(pattern);
    if (match && match[1]) {
      // Filter out common false positives
      const candidate = match[1].toUpperCase();
      if (
        candidate.length >= 4 &&
        candidate.length <= 30 &&
        !/^(THE|AND|FOR|YOUR|THIS|ORDER|SHIP)$/i.test(candidate)
      ) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Extract tracking number from email content
 * Returns both tracking number and detected carrier
 */
export function extractTrackingNumber(body: string): { tracking: string | null; carrier: string | null } {
  for (const { pattern, carrier } of TRACKING_PATTERNS) {
    const match = body.match(pattern);
    if (match && match[1]) {
      const tracking = match[1].toUpperCase();
      // Basic validation - tracking numbers are usually 10-30 chars
      if (tracking.length >= 10 && tracking.length <= 30) {
        return { tracking, carrier };
      }
    }
  }

  return { tracking: null, carrier: null };
}

/**
 * Legacy function for backward compatibility
 */
export function extractTrackingNumberOnly(body: string): string | null {
  return extractTrackingNumber(body).tracking;
}

/**
 * Detect carrier from email content
 */
export function detectCarrier(body: string): string | null {
  for (const [carrier, pattern] of Object.entries(CARRIER_PATTERNS)) {
    if (pattern.test(body)) {
      return carrier;
    }
  }
  return null;
}

/**
 * Parse a date string with intelligent year handling
 */
function parseDate(dateStr: string, referenceDate: Date = new Date()): Date | null {
  // Clean up the date string
  const cleaned = dateStr.trim().replace(/,/g, "");

  // Try direct parsing first
  let parsed = new Date(cleaned);

  // If no year in string, add current or next year
  const hasYear = /\d{4}/.test(cleaned) || /'\d{2}/.test(cleaned);
  if (!hasYear && !isNaN(parsed.getTime())) {
    const currentYear = referenceDate.getFullYear();
    // If the date has already passed this year, assume next year
    if (parsed.getMonth() < referenceDate.getMonth() ||
        (parsed.getMonth() === referenceDate.getMonth() && parsed.getDate() < referenceDate.getDate())) {
      // Only for future-looking dates (delivery), keep as this year for past dates (order)
      parsed.setFullYear(currentYear);
    } else {
      parsed.setFullYear(currentYear);
    }
  }

  // Handle 2-digit years
  if (!isNaN(parsed.getTime()) && parsed.getFullYear() < 100) {
    const century = parsed.getFullYear() < 50 ? 2000 : 1900;
    parsed.setFullYear(parsed.getFullYear() + century);
  }

  // Validate the date is reasonable (not too far in past or future)
  if (!isNaN(parsed.getTime())) {
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const twoYearsFromNow = new Date();
    twoYearsFromNow.setFullYear(twoYearsFromNow.getFullYear() + 2);

    if (parsed >= fiveYearsAgo && parsed <= twoYearsFromNow) {
      return parsed;
    }
  }

  return null;
}

/**
 * Extract dates from email content
 */
export function extractDates(body: string): {
  orderDate: Date | null;
  expectedDeliveryDate: Date | null;
} {
  const now = new Date();
  const dates: Date[] = [];

  for (const pattern of DATE_PATTERNS) {
    const regex = new RegExp(pattern, "gi");
    let match;
    while ((match = regex.exec(body)) !== null) {
      const parsed = parseDate(match[1], now);
      if (parsed) {
        dates.push(parsed);
      }
    }
  }

  // Sort dates chronologically
  dates.sort((a, b) => a.getTime() - b.getTime());

  // Look for delivery date keywords with more patterns
  let expectedDeliveryDate: Date | null = null;
  const deliveryPatterns = [
    /(?:expected|estimated|delivery|arrive|arriving|arrives?|delivering|due)[^.]{0,30}?(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i,
    /(?:expected|estimated|delivery|arrive|arriving|arrives?|delivering|due)[^.]{0,30}?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?)/i,
    /by\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?)/i,
    /(?:between|from)\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}[^.]*?(?:and|to|-)\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2})/i,
    /(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\s*(?:to|-)\s*\d{1,2}[\/\-]\d{1,2}/i, // Take the end of a range
  ];

  for (const pattern of deliveryPatterns) {
    const match = body.match(pattern);
    if (match) {
      const parsed = parseDate(match[1], now);
      if (parsed && parsed > now) {
        expectedDeliveryDate = parsed;
        break;
      }
    }
  }

  return {
    orderDate: dates.length > 0 ? dates[0] : null,
    expectedDeliveryDate,
  };
}

/**
 * Extract total cost from email
 */
export function extractTotalCost(body: string): {
  amount: string | null;
  currency: string;
} {
  for (const pattern of PRICE_PATTERNS) {
    const match = body.match(pattern);
    if (match && match[1]) {
      const amount = match[1].replace(/,/g, "");
      const currencyMatch = body.match(/(?:usd|gbp|eur|\$|£|€)/i);
      let currency = "USD";
      if (currencyMatch) {
        const curr = currencyMatch[0].toLowerCase();
        if (curr === "gbp" || curr === "£") currency = "GBP";
        else if (curr === "eur" || curr === "€") currency = "EUR";
      }
      return { amount, currency };
    }
  }

  return { amount: null, currency: "USD" };
}

/**
 * Main function to parse a supplier email
 */
export function parseSupplierEmail(email: EmailDetails): ParsedOrderData {
  const { subject, from, body, date } = email;

  const status = detectEmailType(subject, body);
  const supplierName = extractSupplierName(from);
  const supplierEmail = extractSupplierEmail(from);
  const orderNumber = extractOrderNumber(subject, body);

  // Extract tracking with carrier detection
  const { tracking: trackingNumber, carrier: trackingCarrier } = extractTrackingNumber(body);

  // Use carrier from tracking pattern if available, otherwise detect from body
  const carrier = trackingCarrier || detectCarrier(body);

  const { orderDate, expectedDeliveryDate } = extractDates(body);
  const { amount: totalCost, currency } = extractTotalCost(body);

  return {
    supplierName,
    supplierEmail,
    orderNumber,
    orderDate: orderDate || date,
    expectedDeliveryDate,
    trackingNumber,
    carrier,
    totalCost,
    currency,
    status,
    items: [], // Item extraction would require more complex parsing
  };
}

/**
 * Check if an email is likely a supplier order email (not promotional)
 *
 * Strategy:
 * 1. First check for STRONG order indicators (order #, tracking #, etc.)
 *    - If found, it's an order email regardless of promotional content in footer
 * 2. If no strong indicators, check if the SUBJECT looks promotional
 *    - Promotional subjects = not an order email
 * 3. Check for weak order indicators as fallback
 */
export function isSupplierOrderEmail(subject: string, body: string): boolean {
  const text = `${subject} ${body}`.toLowerCase();
  const subjectLower = subject.toLowerCase();

  // EXCLUSION: Customer/seller order emails (we're the seller, not buyer)
  const sellerKeywords = [
    "amazon seller central",
    "your sale",
    "customer order",
    "you sold",
    "buyer",
    "seller account",
    "payout",
  ];
  if (sellerKeywords.some((kw) => text.includes(kw))) {
    return false;
  }

  // EXCLUSION: Review/feedback request emails
  // Check subject first - these emails often reference order numbers so check before strong indicators
  const reviewSubjectPatterns = [
    /\breview\b/i,
    /\bfeedback\b/i,
    /\brate\s+(your|us|this|the)\b/i,
    /how\s+(was|did|would you rate)/i,
    /\btell us what you think\b/i,
    /\byour opinion\b/i,
    /\bwe'?d love (to hear|your)\b/i,
    /\bshare your (experience|thoughts)\b/i,
    /\bhow did we do\b/i,
    /\bstar rating\b/i,
  ];
  if (reviewSubjectPatterns.some((pattern) => pattern.test(subjectLower))) {
    return false;
  }

  // Also check body for strong review request indicators
  const reviewBodyPatterns = [
    /leave\s+a?\s*review/i,
    /write\s+a?\s*review/i,
    /rate\s+your\s+(order|purchase|experience)/i,
    /how\s+was\s+your\s+(order|purchase|experience|delivery)/i,
    /we'?d\s+love\s+your\s+feedback/i,
    /share\s+your\s+feedback/i,
    /tell\s+us\s+about\s+your\s+(order|experience)/i,
    /your\s+feedback\s+(matters|helps|is important)/i,
    /please\s+(rate|review)\s+(us|your|this)/i,
    /\b\d\s*stars?\b.*\breview\b/i,
    /click\s+to\s+rate/i,
    /rate\s+now/i,
    /review\s+now/i,
  ];
  if (reviewBodyPatterns.some((pattern) => pattern.test(text))) {
    return false;
  }

  // POSITIVE: Strong indicators this is a real order email
  // If these are present, accept even if there's promotional content in footer
  const strongOrderPatterns = [
    // Order confirmation patterns
    /order\s*(?:#|number|no\.?|id)?[:\s]*[A-Z0-9][-A-Z0-9]{3,}/i,
    /confirmation\s*(?:#|number|no\.?)?[:\s]*[A-Z0-9]/i,
    /your order.*(?:has been|is|was)\s+(?:confirmed|placed|received|shipped)/i,
    /(?:order|purchase)\s+confirmed/i,
    /thank(?:s| you) for your (?:order|purchase)/i,
    /we(?:'ve| have) received your order/i,
    // Shipping/tracking patterns
    /your (?:order|package|parcel|item).*(?:has |is )(?:shipped|dispatched|on its way)/i,
    /tracking\s*(?:#|number|no\.?|id)?[:\s]*[A-Z0-9]{8,}/i,
    /shipped.*tracking/i,
    /dispatch(?:ed)? confirmation/i,
    // Delivery patterns
    /(?:estimated|expected) delivery/i,
    /will (?:be delivered|arrive)/i,
    /out for delivery/i,
    /(?:has been|was) delivered/i,
    /delivery confirmation/i,
    // Invoice patterns
    /invoice\s*(?:#|number|no\.?)?[:\s]*[A-Z0-9]/i,
    /order invoice/i,
    /payment received/i,
    /payment confirmed/i,
  ];

  const hasStrongOrderIndicator = strongOrderPatterns.some((pattern) => pattern.test(text));

  // If we have a strong order indicator, it's likely a real order
  if (hasStrongOrderIndicator) {
    return true;
  }

  // No strong order indicators - check if SUBJECT is promotional
  // (Body may have "unsubscribe" etc in footer, so only check subject)
  const promotionalSubjectPatterns = [
    /\b\d+%\s*off\b/i,
    /\bsale\b/i,
    /\bsave\s+\d+/i,
    /\bsave\s+£/i,
    /\bsave\s+\$/i,
    /\bdiscount/i,
    /\bfree delivery\b/i,
    /\bfree shipping\b/i,
    /\bspecial offer/i,
    /\bdeal/i,
    /\bclearance/i,
    /\bnew arrivals?/i,
    /\bflash sale/i,
    /\blimited time/i,
    /\bdon'?t miss/i,
    /\blast chance/i,
    /\bexclusive/i,
    /\bbest sellers?/i,
    /\brecommended/i,
    /\bjust for you/i,
    /\bwe miss you/i,
    /\bcome back/i,
  ];

  const hasPromotionalSubject = promotionalSubjectPatterns.some((pattern) => pattern.test(subjectLower));

  // If subject is promotional and no strong order indicators, reject
  if (hasPromotionalSubject) {
    return false;
  }

  // WEAK CHECK: Generic order keywords in subject
  const orderSubjectKeywords = [
    "order confirmed",
    "order shipped",
    "order dispatched",
    "shipment",
    "shipped",
    "dispatched",
    "tracking",
    "delivered",
    "invoice",
    "receipt",
  ];
  const hasOrderSubjectKeyword = orderSubjectKeywords.some((kw) => subjectLower.includes(kw));

  return hasOrderSubjectKeyword;
}
