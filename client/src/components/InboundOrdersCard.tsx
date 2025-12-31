import { useState, useEffect, useCallback } from "react";
import {
  Truck,
  RefreshCw,
  Search,
  Calendar,
  AlertCircle,
  Flag,
  ExternalLink,
  Eye,
  Filter,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Mail,
  Trash2,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface SupplierOrder {
  id: string;
  gmailAccountId: string;
  gmailAccountEmail: string | null;
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
  isFlagged: boolean;
  flagReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface OrderStats {
  total: number;
  pending: number;
  confirmed: number;
  shipped: number;
  inTransit: number;
  delivered: number;
  cancelled: number;
  issue: number;
  flagged: number;
  dueToday: number;
  dueThisWeek: number;
}

interface PaginationInfo {
  total: number;
  limit: number;
  offset: number;
}

interface OrdersResponse {
  success: boolean;
  summary?: OrderStats;
  data?: SupplierOrder[];
  pagination?: PaginationInfo;
  error?: string;
}

type DateRange = "7days" | "30days" | "60days" | "90days" | "all";
type SortField = "supplier" | "orderNumber" | "orderDate" | "status" | "expectedDeliveryDate" | "totalCost";
type SortDirection = "asc" | "desc";

interface InboundOrdersCardProps {
  onViewOrder?: (order: SupplierOrder) => void;
  onOrderDeleted?: () => void;
}

const PAGE_SIZE = 25;

export default function InboundOrdersCard({ onViewOrder, onOrderDeleted }: InboundOrdersCardProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OrdersResponse | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>("30days");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortField, setSortField] = useState<SortField>("orderDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [orderToDelete, setOrderToDelete] = useState<SupplierOrder | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearing, setClearing] = useState(false);

  const getDateRangeParams = (range: DateRange) => {
    if (range === "all") return {};

    const now = new Date();
    const endDate = now.toISOString();
    let startDate: Date;

    switch (range) {
      case "7days":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30days":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "60days":
        startDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
        break;
      case "90days":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    return { startDate: startDate.toISOString(), endDate };
  };

  const fetchOrders = useCallback(async () => {
    setLoading(true);

    try {
      const params = new URLSearchParams();
      const dateParams = getDateRangeParams(dateRange);

      if (dateParams.startDate) params.set("startDate", dateParams.startDate);
      if (dateParams.endDate) params.set("endDate", dateParams.endDate);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (flaggedOnly) params.set("flagged", "true");
      if (searchQuery) params.set("search", searchQuery);

      // Add pagination params
      params.set("limit", PAGE_SIZE.toString());
      params.set("offset", ((currentPage - 1) * PAGE_SIZE).toString());

      const response = await fetch(`/api/supplier-orders?${params.toString()}`);
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch orders",
      });
    } finally {
      setLoading(false);
    }
  }, [dateRange, statusFilter, flaggedOnly, searchQuery, currentPage]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [dateRange, statusFilter, flaggedOnly, searchQuery]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleToggleFlag = async (order: SupplierOrder) => {
    try {
      const response = await fetch(`/api/supplier-orders/${order.id}/flag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFlagged: !order.isFlagged }),
      });

      if (response.ok) {
        fetchOrders();
      }
    } catch (error) {
      console.error("Failed to toggle flag:", error);
    }
  };

  const handleDeleteOrder = async () => {
    if (!orderToDelete) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/supplier-orders/${orderToDelete.id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        fetchOrders();
        onOrderDeleted?.();
      }
    } catch (error) {
      console.error("Failed to delete order:", error);
    } finally {
      setDeleting(false);
      setOrderToDelete(null);
    }
  };

  const handleClearAllOrders = async () => {
    setClearing(true);
    try {
      const response = await fetch("/api/supplier-orders", {
        method: "DELETE",
      });

      if (response.ok) {
        const data = await response.json();
        console.log(`Cleared ${data.data?.deletedCount || 0} orders`);
        fetchOrders();
        onOrderDeleted?.();
      }
    } catch (error) {
      console.error("Failed to clear orders:", error);
    } finally {
      setClearing(false);
      setShowClearConfirm(false);
    }
  };

  // Sort orders client-side
  const sortOrders = (orders: SupplierOrder[]) => {
    return [...orders].sort((a, b) => {
      let aVal: string | number | null;
      let bVal: string | number | null;

      switch (sortField) {
        case "supplier":
          aVal = a.supplierName?.toLowerCase() ?? "";
          bVal = b.supplierName?.toLowerCase() ?? "";
          break;
        case "orderNumber":
          aVal = a.orderNumber?.toLowerCase() ?? "";
          bVal = b.orderNumber?.toLowerCase() ?? "";
          break;
        case "orderDate":
          aVal = a.orderDate ? new Date(a.orderDate).getTime() : 0;
          bVal = b.orderDate ? new Date(b.orderDate).getTime() : 0;
          break;
        case "status":
          const statusOrder = ["pending", "confirmed", "shipped", "in_transit", "delivered", "cancelled", "issue"];
          aVal = statusOrder.indexOf(a.status);
          bVal = statusOrder.indexOf(b.status);
          break;
        case "expectedDeliveryDate":
          aVal = a.expectedDeliveryDate ? new Date(a.expectedDeliveryDate).getTime() : 0;
          bVal = b.expectedDeliveryDate ? new Date(b.expectedDeliveryDate).getTime() : 0;
          break;
        case "totalCost":
          aVal = a.totalCost ? parseFloat(a.totalCost) : 0;
          bVal = b.totalCost ? parseFloat(b.totalCost) : 0;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  };

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (field !== sortField) {
      return <ArrowUpDown className="h-4 w-4 ml-1 opacity-50" />;
    }
    return sortDirection === "asc"
      ? <ArrowUp className="h-4 w-4 ml-1" />
      : <ArrowDown className="h-4 w-4 ml-1" />;
  };

  const rawOrders = result?.data || [];
  const orders = sortOrders(rawOrders);
  const summary = result?.summary;

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string }> = {
      pending: { label: "Pending", className: "bg-amber-600 text-white" },
      confirmed: { label: "Confirmed", className: "bg-purple-600 text-white" },
      shipped: { label: "Shipped", className: "bg-blue-600 text-white" },
      in_transit: { label: "In Transit", className: "bg-blue-500 text-white" },
      delivered: { label: "Delivered", className: "bg-green-600 text-white" },
      cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
      issue: { label: "Issue", className: "bg-red-600 text-white" },
    };

    const config = statusConfig[status] || { label: status, className: "bg-muted" };
    return <Badge className={config.className}>{config.label}</Badge>;
  };

  const getCarrierTrackingUrl = (carrier: string | null, trackingNumber: string | null) => {
    if (!trackingNumber) return null;

    const urls: Record<string, string> = {
      UPS: `https://www.ups.com/track?tracknum=${trackingNumber}`,
      FedEx: `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`,
      USPS: `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`,
      DHL: `https://www.dhl.com/us-en/home/tracking/tracking-global-forwarding.html?submit=1&tracking-id=${trackingNumber}`,
    };

    return carrier && urls[carrier] ? urls[carrier] : null;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "-";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Supplier Orders</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowClearConfirm(true)}
              disabled={loading || clearing}
              className="text-muted-foreground hover:text-destructive"
            >
              <RotateCcw className="h-4 w-4 mr-1" />
              Clear All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchOrders}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
        <CardDescription>
          Track inbound orders from your suppliers
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-3">
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold">{summary.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
            <div className="bg-orange-50 dark:bg-orange-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-orange-600">{summary.dueToday}</p>
              <p className="text-xs text-muted-foreground">Due Today</p>
            </div>
            <div className="bg-cyan-50 dark:bg-cyan-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-cyan-600">{summary.dueThisWeek}</p>
              <p className="text-xs text-muted-foreground">Due This Week</p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-600">{summary.pending}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-purple-600">{summary.confirmed}</p>
              <p className="text-xs text-muted-foreground">Confirmed</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{summary.shipped + summary.inTransit}</p>
              <p className="text-xs text-muted-foreground">In Transit</p>
            </div>
            <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{summary.delivered}</p>
              <p className="text-xs text-muted-foreground">Delivered</p>
            </div>
            <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-600">{summary.flagged}</p>
              <p className="text-xs text-muted-foreground">Flagged</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-muted-foreground">{summary.cancelled}</p>
              <p className="text-xs text-muted-foreground">Cancelled</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
            <SelectTrigger className="w-40">
              <Calendar className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Date range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7days">Last 7 Days</SelectItem>
              <SelectItem value="30days">Last 30 Days</SelectItem>
              <SelectItem value="60days">Last 60 Days</SelectItem>
              <SelectItem value="90days">Last 90 Days</SelectItem>
              <SelectItem value="all">All Time</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
              <SelectItem value="shipped">Shipped</SelectItem>
              <SelectItem value="in_transit">In Transit</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="issue">Issue</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Checkbox
              id="flagged-only"
              checked={flaggedOnly}
              onCheckedChange={(checked) => setFlaggedOnly(checked === true)}
            />
            <label htmlFor="flagged-only" className="text-sm text-muted-foreground cursor-pointer">
              Flagged only
            </label>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by order #, supplier, or tracking..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Error State */}
        {result?.error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
            <div>
              <p className="font-medium text-red-600">Error loading orders</p>
              <p className="text-sm text-red-600/80">{result.error}</p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty State */}
        {!loading && orders.length === 0 && !result?.error && (
          <div className="text-center py-12 text-muted-foreground">
            <Truck className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No supplier orders found</p>
            <p className="text-sm mt-1">
              Connect Gmail accounts in Settings to start tracking orders
            </p>
          </div>
        )}

        {/* Orders Table */}
        {!loading && orders.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"></TableHead>
                  <TableHead>
                    <button
                      onClick={() => handleSort("supplier")}
                      className="flex items-center hover:text-foreground transition-colors"
                    >
                      Supplier
                      <SortIcon field="supplier" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => handleSort("orderNumber")}
                      className="flex items-center hover:text-foreground transition-colors"
                    >
                      Order #
                      <SortIcon field="orderNumber" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => handleSort("orderDate")}
                      className="flex items-center hover:text-foreground transition-colors"
                    >
                      Date
                      <SortIcon field="orderDate" />
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => handleSort("status")}
                      className="flex items-center hover:text-foreground transition-colors"
                    >
                      Status
                      <SortIcon field="status" />
                    </button>
                  </TableHead>
                  <TableHead>Tracking</TableHead>
                  <TableHead>
                    <button
                      onClick={() => handleSort("expectedDeliveryDate")}
                      className="flex items-center hover:text-foreground transition-colors"
                    >
                      Expected
                      <SortIcon field="expectedDeliveryDate" />
                    </button>
                  </TableHead>
                  <TableHead className="text-right">
                    <button
                      onClick={() => handleSort("totalCost")}
                      className="flex items-center justify-end hover:text-foreground transition-colors w-full"
                    >
                      Cost
                      <SortIcon field="totalCost" />
                    </button>
                  </TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order) => {
                  const trackingUrl = getCarrierTrackingUrl(order.carrier, order.trackingNumber);

                  return (
                    <TableRow key={order.id} className="hover:bg-muted/50">
                      <TableCell>
                        <button
                          onClick={() => handleToggleFlag(order)}
                          className={`p-1 rounded ${
                            order.isFlagged
                              ? "text-red-600 hover:text-red-700"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                          title={order.flagReason || "Toggle flag"}
                        >
                          <Flag className={`h-4 w-4 ${order.isFlagged ? "fill-current" : ""}`} />
                        </button>
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{order.supplierName || "Unknown"}</p>
                          {order.supplierEmail && (
                            <p className="text-xs text-muted-foreground truncate max-w-[150px]">
                              {order.supplierEmail}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm">
                          {order.orderNumber || "-"}
                        </span>
                      </TableCell>
                      <TableCell>{formatDate(order.orderDate)}</TableCell>
                      <TableCell>{getStatusBadge(order.status)}</TableCell>
                      <TableCell>
                        {order.trackingNumber ? (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-xs truncate max-w-[100px]">
                              {order.trackingNumber}
                            </span>
                            {trackingUrl && (
                              <a
                                href={trackingUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:text-primary/80"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>{formatDate(order.expectedDeliveryDate)}</TableCell>
                      <TableCell className="text-right">
                        {order.totalCost ? (
                          <span className="font-medium">
                            ${parseFloat(order.totalCost).toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {order.emailMessageId && (
                            <Button
                              variant="ghost"
                              size="sm"
                              asChild
                              title="View source email in Gmail"
                            >
                              <a
                                href={order.gmailAccountEmail
                                  ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(order.gmailAccountEmail)}#inbox/${order.emailMessageId}`
                                  : `https://mail.google.com/mail/u/0/#inbox/${order.emailMessageId}`
                                }
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Mail className="h-4 w-4" />
                              </a>
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onViewOrder?.(order)}
                            title="View order details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setOrderToDelete(order)}
                            title="Delete order"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Pagination */}
        {result?.pagination && result.pagination.total > PAGE_SIZE && (
          <div className="flex items-center justify-between pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              Showing {((currentPage - 1) * PAGE_SIZE) + 1} - {Math.min(currentPage * PAGE_SIZE, result.pagination.total)} of {result.pagination.total} orders
            </p>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1 || loading}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1 || loading}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-3 text-sm">
                Page {currentPage} of {Math.ceil(result.pagination.total / PAGE_SIZE)}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={currentPage >= Math.ceil(result.pagination.total / PAGE_SIZE) || loading}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(Math.ceil(result.pagination.total / PAGE_SIZE))}
                disabled={currentPage >= Math.ceil(result.pagination.total / PAGE_SIZE) || loading}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Footer for small result sets */}
        {orders.length > 0 && (!result?.pagination || result.pagination.total <= PAGE_SIZE) && (
          <p className="text-sm text-muted-foreground text-center pt-2">
            Showing {orders.length} order{orders.length !== 1 ? "s" : ""}
          </p>
        )}

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={!!orderToDelete} onOpenChange={(open) => !open && setOrderToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Order</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this order from {orderToDelete?.supplierName || "Unknown"}?
                {orderToDelete?.orderNumber && ` (Order #${orderToDelete.orderNumber})`}
                {" "}This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteOrder}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Clear All Confirmation Dialog */}
        <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear All Orders</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete ALL supplier orders? This will remove {summary?.total || 0} orders.
                This is intended for development/testing purposes. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={clearing}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleClearAllOrders}
                disabled={clearing}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {clearing ? "Clearing..." : "Clear All Orders"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
