// Email Parser for Supplier Order Emails

import type { EmailDetails } from "./gmail";
import type { SupplierOrderStatus } from "@shared/schema";

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
  // DHL: 10 or 11 digits
  { pattern: /\b(\d{10,11})\b(?=.*dhl)/i, carrier: "DHL" },
  // Amazon Logistics: TBA followed by digits
  { pattern: /(TBA\d{12,})/i, carrier: "Amazon" },
  // Generic tracking with keyword context
  { pattern: /tracking\s*(?:#|number|no\.?|id)?[:\s]*([A-Z0-9]{10,30})/i, carrier: null },
  { pattern: /track(?:ing)?\s+(?:your\s+)?(?:package|shipment|order)[:\s]*([A-Z0-9]{10,30})/i, carrier: null },
];

// Carrier detection patterns - expanded for more carriers
const CARRIER_PATTERNS: Record<string, RegExp> = {
  UPS: /\bups\b|united\s+parcel|1Z[A-Z0-9]{16}/i,
  FedEx: /\bfedex\b|federal\s+express/i,
  USPS: /\busps\b|postal\s+service|united\s+states\s+postal|first[\s-]?class|priority\s+mail/i,
  DHL: /\bdhl\b|deutsche\s+post/i,
  Amazon: /\bamazon\s+logistics\b|amzl|TBA\d{12,}/i,
  OnTrac: /\bontrac\b/i,
  LaserShip: /\blasership\b/i,
  Spee_Dee: /\bspee[\s-]?dee\b/i,
  GLS: /\bgls\b|general\s+logistics/i,
  Purolator: /\bpurolator\b/i,
  Canada_Post: /\bcanada\s+post\b/i,
  LSO: /\blso\b|lone\s+star\s+overnight/i,
  Saia: /\bsaia\b/i,
  Estes: /\bestes\b/i,
  XPO: /\bxpo\b/i,
  "R+L": /\br\+l\s+carriers\b|r\s*\+\s*l/i,
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
 * Check if an email is likely a supplier order email
 */
export function isSupplierOrderEmail(subject: string, body: string): boolean {
  const text = `${subject} ${body}`.toLowerCase();

  // Keywords that suggest this is an order-related email
  const orderKeywords = [
    "order",
    "confirmation",
    "shipped",
    "tracking",
    "delivery",
    "invoice",
    "purchase",
    "shipment",
  ];

  // Keywords that suggest this is NOT a supplier order (e.g., customer orders)
  const excludeKeywords = [
    "amazon seller central",
    "your sale",
    "customer order",
    "you sold",
    "buyer",
  ];

  const hasOrderKeyword = orderKeywords.some((kw) => text.includes(kw));
  const hasExcludeKeyword = excludeKeywords.some((kw) => text.includes(kw));

  return hasOrderKeyword && !hasExcludeKeyword;
}
