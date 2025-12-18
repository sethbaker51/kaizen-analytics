import { useState, useEffect, useCallback } from "react";
import { Package, RefreshCw, Search, Filter, AlertCircle } from "lucide-react";
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

interface InventoryItem {
  asin: string;
  fnSku: string;
  sellerSku: string;
  productName: string;
  condition: string;
  lastUpdatedTime: string;
  totalQuantity: number;
  fulfillableQuantity: number;
  inboundWorking: number;
  inboundShipped: number;
  inboundReceiving: number;
  reservedQuantity: number;
  unfulfillableQuantity: number;
  researchingQuantity: number;
}

interface InventorySummary {
  totalItems: number;
  activeItems: number;
  inactiveItems: number;
  totalFulfillable: number;
  totalInbound: number;
  totalUnfulfillable: number;
  totalReserved: number;
  hasMore: boolean;
}

interface InventoryResponse {
  success: boolean;
  data?: {
    summary: InventorySummary;
    inventory: InventoryItem[];
  };
  error?: string;
}

export default function InventoryCard() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InventoryResponse | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const fetchInventory = useCallback(async () => {
    setLoading(true);

    try {
      const response = await fetch("/api/inventory");
      const data = await response.json();
      setResult(data);
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch inventory",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  // Filter inventory based on search query and status
  const inventory = result?.data?.inventory || [];
  const filteredInventory = inventory.filter((item) => {
    // Status filter
    if (statusFilter === "active" && item.fulfillableQuantity === 0) {
      return false;
    }
    if (statusFilter === "inactive" && item.fulfillableQuantity > 0) {
      return false;
    }

    // Search filter
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      item.sellerSku.toLowerCase().includes(query) ||
      item.asin.toLowerCase().includes(query) ||
      item.productName?.toLowerCase().includes(query) ||
      item.fnSku?.toLowerCase().includes(query)
    );
  });

  const getStatusBadge = (item: InventoryItem) => {
    if (item.fulfillableQuantity > 0) {
      return <Badge variant="default" className="bg-green-600">Active</Badge>;
    }
    if (item.inboundWorking + item.inboundShipped + item.inboundReceiving > 0) {
      return <Badge variant="secondary" className="bg-blue-600 text-white">Inbound</Badge>;
    }
    if (item.unfulfillableQuantity > 0) {
      return <Badge variant="destructive">Unfulfillable</Badge>;
    }
    return <Badge variant="outline">Inactive</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            <div>
              <CardTitle>FBA Inventory</CardTitle>
              <CardDescription>Your current inventory levels across Amazon fulfillment centers</CardDescription>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchInventory}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary Stats */}
        {result?.success && result.data && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold">
                {result.data.summary.totalItems}{result.data.summary.hasMore && "+"}
              </p>
              <p className="text-xs text-muted-foreground">
                {result.data.summary.hasMore ? "SKUs (partial)" : "Total SKUs"}
              </p>
            </div>
            <div className="bg-green-50 dark:bg-green-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-green-600">
                {result.data.summary.activeItems}{result.data.summary.hasMore && "+"}
              </p>
              <p className="text-xs text-muted-foreground">Active</p>
            </div>
            <div className="bg-muted/50 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold">
                {result.data.summary.inactiveItems}{result.data.summary.hasMore && "+"}
              </p>
              <p className="text-xs text-muted-foreground">Inactive</p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-blue-600">{result.data.summary.totalFulfillable.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Fulfillable</p>
            </div>
            <div className="bg-purple-50 dark:bg-purple-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-purple-600">{result.data.summary.totalInbound.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Inbound</p>
            </div>
            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-amber-600">{result.data.summary.totalReserved.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Reserved</p>
            </div>
            <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 text-center">
              <p className="text-2xl font-bold text-red-600">{result.data.summary.totalUnfulfillable.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">Unfulfillable</p>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by SKU, ASIN, or product name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-40">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Items</SelectItem>
              <SelectItem value="active">Active Only</SelectItem>
              <SelectItem value="inactive">Inactive Only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Error State */}
        {result?.success === false && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
            <div>
              <p className="font-medium text-red-600">Failed to load inventory</p>
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

        {/* Inventory Table */}
        {result?.success && !loading && (
          <>
            {filteredInventory.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No inventory items found</p>
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
                        <TableHead>SKU</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>ASIN</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                        <TableHead className="text-right">Fulfillable</TableHead>
                        <TableHead className="text-right">Inbound</TableHead>
                        <TableHead className="text-right">Reserved</TableHead>
                        <TableHead className="text-right">Unfulfillable</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredInventory.map((item, index) => (
                        <TableRow key={`${item.sellerSku}-${index}`}>
                          <TableCell className="font-mono text-sm">
                            <div>
                              <p className="font-medium">{item.sellerSku}</p>
                              {item.fnSku && (
                                <p className="text-xs text-muted-foreground">{item.fnSku}</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="max-w-xs">
                            <p className="truncate text-sm" title={item.productName}>
                              {item.productName || "-"}
                            </p>
                          </TableCell>
                          <TableCell className="font-mono text-sm">{item.asin}</TableCell>
                          <TableCell className="text-center">{getStatusBadge(item)}</TableCell>
                          <TableCell className="text-right font-medium">
                            {item.fulfillableQuantity.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-blue-600">
                              {(item.inboundWorking + item.inboundShipped + item.inboundReceiving).toLocaleString()}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-amber-600">
                              {item.reservedQuantity.toLocaleString()}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={item.unfulfillableQuantity > 0 ? "text-red-600" : ""}>
                              {item.unfulfillableQuantity.toLocaleString()}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground text-right">
              Showing {filteredInventory.length} of {inventory.length} items
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
