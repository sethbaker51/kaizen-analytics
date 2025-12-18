import { useState, useEffect, useCallback } from "react";
import { ShoppingCart, RefreshCw, Search, Calendar, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

interface OrderItem {
  asin: string;
  sku: string;
  title: string;
  quantity: number;
  itemPrice: number | null;
}

interface Order {
  orderId: string;
  purchaseDate: string;
  lastUpdateDate: string;
  orderStatus: string;
  fulfillmentChannel: string;
  salesChannel: string;
  orderTotal: number | null;
  currency: string;
  numberOfItems: number;
  itemsShipped: number;
  itemsUnshipped: number;
  paymentMethod: string;
  isPrime: boolean;
  isBusinessOrder: boolean;
  shipCity: string;
  shipState: string;
  shipPostalCode: string;
  items: OrderItem[];
}

interface OrdersSummary {
  totalOrders: number;
  pendingOrders: number;
  unshippedOrders: number;
  shippedOrders: number;
  canceledOrders: number;
  totalRevenue: number;
  currency: string;
  hasMore: boolean;
}

interface OrdersResponse {
  success: boolean;
  data?: {
    summary: OrdersSummary;
    orders: Order[];
  };
  error?: string;
}

type DateRange = "today" | "yesterday" | "7days" | "30days" | "60days" | "90days";

export default function OrdersCard() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OrdersResponse | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>("yesterday");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const getDateRangeParams = (range: DateRange) => {
    const now = new Date();
    // SP-API requires end date to be at least 2 minutes in the past
    const endDate = new Date(now.getTime() - 3 * 60 * 1000); // 3 min buffer
    let startDate: Date;

    switch (range) {
      case "today":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "yesterday":
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
        // For yesterday, end date should be start of today
        return {
          startDate: startDate.toISOString(),
          endDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
        };
      case "7days":
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "30days":
        startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "60days":
        startDate = new Date(endDate.getTime() - 60 * 24 * 60 * 60 * 1000);
        break;
      case "90days":
        startDate = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    return { startDate: startDate.toISOString(), endDate: endDate.toISOString() };
  };

  const fetchOrders = useCallback(async () => {
    setLoading(true);

    try {
      const { startDate, endDate } = getDateRangeParams(dateRange);
      const params = new URLSearchParams({
        startDate,
        endDate,
      });

      if (statusFilter !== "all") {
        params.set("status", statusFilter);
      }

      const response = await fetch(`/api/orders?${params.toString()}`);
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
  }, [dateRange, statusFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Filter orders based on search query
  const orders = result?.data?.orders || [];
  const filteredOrders = orders.filter((order) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      order.orderId.toLowerCase().includes(query) ||
      order.shipCity?.toLowerCase().includes(query) ||
      order.shipState?.toLowerCase().includes(query)
    );
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Shipped":
        return <Badge variant="default" className="bg-green-600">Shipped</Badge>;
      case "Unshipped":
        return <Badge variant="secondary" className="bg-blue-600 text-white">Unshipped</Badge>;
      case "Pending":
        return <Badge variant="secondary" className="bg-amber-600 text-white">Pending</Badge>;
      case "Canceled":
        return <Badge variant="destructive">Canceled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const formatCurrency = (amount: number | null, currency: string) => {
    if (amount === null || amount === 0) return "-";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
    }).format(amount);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" />
            <div>
              <CardTitle>Orders</CardTitle>
              <CardDescription>View and track your Amazon orders</CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchOrders}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Date Range Selector */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Select value={dateRange} onValueChange={(v) => setDateRange(v as DateRange)}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Date range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="7days">Last 7 Days</SelectItem>
                <SelectItem value="30days">Last 30 Days</SelectItem>
                <SelectItem value="60days">Last 60 Days</SelectItem>
                <SelectItem value="90days">Last 90 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Unshipped">Unshipped</SelectItem>
              <SelectItem value="Shipped">Shipped</SelectItem>
              <SelectItem value="Canceled">Canceled</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Summary Stats */}
        {result?.success && result.data && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold">
                {result.data.summary.totalOrders}{result.data.summary.hasMore && "+"}
              </p>
              <p className="text-xs text-muted-foreground">Total Orders</p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-600">{result.data.summary.pendingOrders}</p>
              <p className="text-xs text-muted-foreground">Pending</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{result.data.summary.unshippedOrders}</p>
              <p className="text-xs text-muted-foreground">Unshipped</p>
            </div>
            <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{result.data.summary.shippedOrders}</p>
              <p className="text-xs text-muted-foreground">Shipped</p>
            </div>
            <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-600">{result.data.summary.canceledOrders}</p>
              <p className="text-xs text-muted-foreground">Canceled</p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-purple-600">
                {formatCurrency(result.data.summary.totalRevenue, result.data.summary.currency)}
              </p>
              <p className="text-xs text-muted-foreground">Revenue</p>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by order ID, city, or state..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Error State */}
        {result?.success === false && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
            <div>
              <p className="font-medium text-red-600">Failed to load orders</p>
              <p className="text-sm text-red-600/80 font-mono mt-1">{result.error}</p>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Orders Table */}
        {result?.success && !loading && (
          <>
            {filteredOrders.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <ShoppingCart className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No orders found</p>
                {searchQuery && (
                  <p className="text-sm mt-1">Try adjusting your search or filters</p>
                )}
              </div>
            ) : (
              <div className="border rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Order ID</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>ASIN</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="text-center">Qty</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredOrders.map((order) => (
                        <TableRow key={order.orderId}>
                          <TableCell className="font-mono text-sm">
                            <div>
                              <a
                                href={`https://sellercentral.amazon.com/orders-v3/order/${order.orderId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                              >
                                {order.orderId}
                              </a>
                              {order.isPrime && (
                                <Badge variant="outline" className="text-xs mt-1">Prime</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatDate(order.purchaseDate)}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {order.items.length > 0 ? (
                              <div className="space-y-1">
                                {order.items.map((item, idx) => (
                                  <a
                                    key={idx}
                                    href={`https://www.amazon.com/dp/${item.asin}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block text-blue-600 hover:text-blue-800 hover:underline"
                                  >
                                    {item.asin}
                                  </a>
                                ))}
                              </div>
                            ) : "-"}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {order.items.length > 0 ? (
                              <div className="space-y-1">
                                {order.items.map((item, idx) => (
                                  <a
                                    key={idx}
                                    href={`https://sellercentral.amazon.com/skucentral?mSku=${encodeURIComponent(item.sku)}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block text-blue-600 hover:text-blue-800 hover:underline"
                                  >
                                    {item.sku}
                                  </a>
                                ))}
                              </div>
                            ) : "-"}
                          </TableCell>
                          <TableCell className="text-center">
                            {getStatusBadge(order.orderStatus)}
                          </TableCell>
                          <TableCell className="text-center">
                            {order.numberOfItems}
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatCurrency(order.orderTotal, order.currency)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground text-right">
              Showing {filteredOrders.length} of {orders.length} orders
              {result.data?.summary.hasMore && " (more available)"}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
