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

// Tracking number patterns
const TRACKING_PATTERNS = [
  /tracking\s*(?:#|number|no\.?|id)?[:\s]*([A-Z0-9]{8,30})/i,
  /track(?:ing)?\s+(?:your\s+)?(?:package|shipment|order)[:\s]*([A-Z0-9]{8,30})/i,
  /(?:ups|fedex|usps|dhl)\s*(?:#|tracking)?[:\s]*([A-Z0-9]{8,30})/i,
  /shipment\s*(?:#|id)?[:\s]*([A-Z0-9]{8,30})/i,
  /(?:1Z[A-Z0-9]{16})/i, // UPS
  /(?:\d{12,22})/i, // FedEx/USPS
];

// Carrier detection patterns
const CARRIER_PATTERNS: Record<string, RegExp> = {
  UPS: /\bups\b|united\s+parcel|1Z[A-Z0-9]{16}/i,
  FedEx: /\bfedex\b|federal\s+express/i,
  USPS: /\busps\b|postal\s+service|united\s+states\s+postal/i,
  DHL: /\bdhl\b/i,
  Amazon: /\bamazon\s+logistics\b|amzl/i,
  OnTrac: /\bontrac\b/i,
  LaserShip: /\blasership\b/i,
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
 */
export function extractTrackingNumber(body: string): string | null {
  for (const pattern of TRACKING_PATTERNS) {
    const match = body.match(pattern);
    if (match && match[1]) {
      const tracking = match[1].toUpperCase();
      // Basic validation - tracking numbers are usually 8-30 chars
      if (tracking.length >= 8 && tracking.length <= 30) {
        return tracking;
      }
    }
  }

  return null;
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
 * Extract dates from email content
 */
export function extractDates(body: string): {
  orderDate: Date | null;
  expectedDeliveryDate: Date | null;
} {
  const dates: Date[] = [];

  for (const pattern of DATE_PATTERNS) {
    const regex = new RegExp(pattern, "gi");
    let match;
    while ((match = regex.exec(body)) !== null) {
      try {
        const parsed = new Date(match[1]);
        if (!isNaN(parsed.getTime())) {
          dates.push(parsed);
        }
      } catch {
        // Ignore unparseable dates
      }
    }
  }

  // Sort dates
  dates.sort((a, b) => a.getTime() - b.getTime());

  // Look for delivery date keywords
  let expectedDeliveryDate: Date | null = null;
  const deliveryPatterns = [
    /(?:expected|estimated|delivery|arrive|arriving)[^.]*?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i,
    /(?:expected|estimated|delivery|arrive|arriving)[^.]*?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2})/i,
    /by\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2})/i,
  ];

  for (const pattern of deliveryPatterns) {
    const match = body.match(pattern);
    if (match) {
      try {
        const parsed = new Date(match[1]);
        if (!isNaN(parsed.getTime())) {
          expectedDeliveryDate = parsed;
          break;
        }
      } catch {
        // Ignore
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
  const trackingNumber = extractTrackingNumber(body);
  const carrier = detectCarrier(body);
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
