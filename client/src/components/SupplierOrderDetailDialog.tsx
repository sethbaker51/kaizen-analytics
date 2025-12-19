import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Truck,
  Calendar,
  Package,
  Flag,
  ExternalLink,
  Mail,
  Save,
  Loader2,
  ShoppingCart,
} from "lucide-react";

interface SupplierOrderItem {
  id: string;
  orderId: string;
  sku: string | null;
  asin: string | null;
  productName: string | null;
  quantity: number | null;
  unitCost: string | null;
  totalCost: string | null;
}

interface SupplierOrder {
  id: string;
  gmailAccountId: string;
  emailMessageId: string;
  supplierName: string | null;
  supplierEmail: string | null;
  orderNumber: string | null;
  orderDate: string | null;
  expectedDeliveryDate: string | null;
  actualDeliveryDate: string | null;
  status: string;
  trackingNumber: string | null;
  carrier: string | null;
  totalCost: string | null;
  currency: string;
  notes: string | null;
  emailSubject: string | null;
  emailSnippet?: string | null;
  isFlagged: boolean;
  flagReason: string | null;
  createdAt: string;
  updatedAt: string;
  items?: SupplierOrderItem[];
}

interface SupplierOrderDetailDialogProps {
  order: SupplierOrder | null;
  onClose: () => void;
  onSave?: () => void;
}

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "shipped", label: "Shipped" },
  { value: "in_transit", label: "In Transit" },
  { value: "delivered", label: "Delivered" },
  { value: "cancelled", label: "Cancelled" },
  { value: "issue", label: "Issue" },
];

const CARRIER_OPTIONS = [
  { value: "UPS", label: "UPS" },
  { value: "FedEx", label: "FedEx" },
  { value: "USPS", label: "USPS" },
  { value: "DHL", label: "DHL" },
  { value: "Amazon", label: "Amazon Logistics" },
  { value: "Other", label: "Other" },
];

export default function SupplierOrderDetailDialog({
  order,
  onClose,
  onSave,
}: SupplierOrderDetailDialogProps) {
  const [status, setStatus] = useState(order?.status || "pending");
  const [trackingNumber, setTrackingNumber] = useState(order?.trackingNumber || "");
  const [carrier, setCarrier] = useState(order?.carrier || "");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState(
    order?.expectedDeliveryDate?.split("T")[0] || ""
  );
  const [actualDeliveryDate, setActualDeliveryDate] = useState(
    order?.actualDeliveryDate?.split("T")[0] || ""
  );
  const [notes, setNotes] = useState(order?.notes || "");
  const [isFlagged, setIsFlagged] = useState(order?.isFlagged || false);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<SupplierOrderItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Fetch order details with items when dialog opens
  useEffect(() => {
    if (order?.id) {
      setLoadingItems(true);
      fetch(`/api/supplier-orders/${order.id}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.data?.items) {
            setItems(data.data.items);
          }
        })
        .catch(console.error)
        .finally(() => setLoadingItems(false));
    } else {
      setItems([]);
    }
  }, [order?.id]);

  // Reset form when order changes
  useEffect(() => {
    if (order) {
      setStatus(order.status);
      setTrackingNumber(order.trackingNumber || "");
      setCarrier(order.carrier || "");
      setExpectedDeliveryDate(order.expectedDeliveryDate?.split("T")[0] || "");
      setActualDeliveryDate(order.actualDeliveryDate?.split("T")[0] || "");
      setNotes(order.notes || "");
      setIsFlagged(order.isFlagged);
    }
  }, [order]);

  const handleSave = async () => {
    if (!order) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/supplier-orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          trackingNumber: trackingNumber || null,
          carrier: carrier || null,
          expectedDeliveryDate: expectedDeliveryDate || null,
          actualDeliveryDate: actualDeliveryDate || null,
          notes: notes || null,
        }),
      });

      if (response.ok) {
        // Update flag separately if changed
        if (isFlagged !== order.isFlagged) {
          await fetch(`/api/supplier-orders/${order.id}/flag`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isFlagged }),
          });
        }

        onSave?.();
        onClose();
      }
    } catch (error) {
      console.error("Failed to save order:", error);
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (statusValue: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      pending: { label: "Pending", className: "bg-amber-600 text-white" },
      confirmed: { label: "Confirmed", className: "bg-purple-600 text-white" },
      shipped: { label: "Shipped", className: "bg-blue-600 text-white" },
      in_transit: { label: "In Transit", className: "bg-blue-500 text-white" },
      delivered: { label: "Delivered", className: "bg-green-600 text-white" },
      cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
      issue: { label: "Issue", className: "bg-red-600 text-white" },
    };

    const config = statusConfig[statusValue] || { label: statusValue, className: "bg-muted" };
    return <Badge className={config.className}>{config.label}</Badge>;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  if (!order) return null;

  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Order Details
          </DialogTitle>
          <DialogDescription>
            {order.supplierName || "Unknown Supplier"} - {order.orderNumber || "No Order #"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Order Header */}
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold">{order.supplierName || "Unknown Supplier"}</h3>
              {order.supplierEmail && (
                <p className="text-sm text-muted-foreground">{order.supplierEmail}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {getStatusBadge(order.status)}
              {order.isFlagged && (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <Flag className="h-3 w-3" />
                  Flagged
                </Badge>
              )}
            </div>
          </div>

          {/* Order Info */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
            <div>
              <p className="text-sm text-muted-foreground">Order Number</p>
              <p className="font-mono font-medium">{order.orderNumber || "-"}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Order Date</p>
              <p className="font-medium">{formatDate(order.orderDate)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total Cost</p>
              <p className="font-medium">
                {order.totalCost ? `$${parseFloat(order.totalCost).toFixed(2)}` : "-"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Created</p>
              <p className="font-medium">{formatDate(order.createdAt)}</p>
            </div>
          </div>

          {/* Editable Fields */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Status */}
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Carrier */}
              <div className="space-y-2">
                <Label>Carrier</Label>
                <Select value={carrier} onValueChange={setCarrier}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select carrier" />
                  </SelectTrigger>
                  <SelectContent>
                    {CARRIER_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Tracking Number */}
            <div className="space-y-2">
              <Label>Tracking Number</Label>
              <div className="flex gap-2">
                <Input
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  placeholder="Enter tracking number"
                  className="font-mono"
                />
                {trackingNumber && carrier && (
                  <Button variant="outline" size="icon" asChild>
                    <a
                      href={getTrackingUrl(carrier, trackingNumber)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* Expected Delivery */}
              <div className="space-y-2">
                <Label>Expected Delivery</Label>
                <Input
                  type="date"
                  value={expectedDeliveryDate}
                  onChange={(e) => setExpectedDeliveryDate(e.target.value)}
                />
              </div>

              {/* Actual Delivery */}
              <div className="space-y-2">
                <Label>Actual Delivery</Label>
                <Input
                  type="date"
                  value={actualDeliveryDate}
                  onChange={(e) => setActualDeliveryDate(e.target.value)}
                />
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this order..."
                rows={3}
              />
            </div>

            {/* Flag Toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsFlagged(!isFlagged)}
                className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                  isFlagged
                    ? "border-red-300 bg-red-50 dark:bg-red-950/30 text-red-600"
                    : "border-muted hover:bg-muted"
                }`}
              >
                <Flag className={`h-4 w-4 ${isFlagged ? "fill-current" : ""}`} />
                <span className="text-sm">{isFlagged ? "Flagged for Attention" : "Flag Order"}</span>
              </button>
              {order.flagReason && isFlagged && (
                <span className="text-sm text-muted-foreground">{order.flagReason}</span>
              )}
            </div>
          </div>

          {/* Order Items */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ShoppingCart className="h-4 w-4" />
              <span>Order Items</span>
            </div>
            {loadingItems ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : items.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Cost</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium">
                          {item.productName || "-"}
                          {item.asin && (
                            <span className="text-xs text-muted-foreground ml-2">
                              ({item.asin})
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {item.sku || "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.quantity ?? "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.unitCost ? `$${parseFloat(item.unitCost).toFixed(2)}` : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {item.totalCost ? `$${parseFloat(item.totalCost).toFixed(2)}` : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-2">
                No items parsed from email. Item extraction requires structured order confirmations.
              </p>
            )}
          </div>

          {/* Email Preview */}
          {order.emailSubject && (
            <div className="space-y-2 p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span>Source Email</span>
                </div>
                {order.emailMessageId && (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`https://mail.google.com/mail/u/0/#inbox/${order.emailMessageId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View in Gmail
                    </a>
                  </Button>
                )}
              </div>
              <p className="font-medium">{order.emailSubject}</p>
              {order.emailSnippet && (
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {order.emailSnippet}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getTrackingUrl(carrier: string, trackingNumber: string): string {
  const urls: Record<string, string> = {
    UPS: `https://www.ups.com/track?tracknum=${trackingNumber}`,
    FedEx: `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`,
    USPS: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`,
    DHL: `https://www.dhl.com/us-en/home/tracking/tracking-global-forwarding.html?submit=1&tracking-id=${trackingNumber}`,
    Amazon: `https://track.amazon.com/tracking/${trackingNumber}`,
  };

  return urls[carrier] || `https://www.google.com/search?q=${trackingNumber}+tracking`;
}
