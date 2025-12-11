import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DollarSign, Package, ShoppingCart, RefreshCw, Loader2, TrendingUp } from "lucide-react";

type DateRange = "today" | "7days" | "30days" | "60days" | "ytd" | "lastyear";

interface SalesData {
  totalSales: number;
  currency: string;
  unitCount: number;
  orderCount: number;
  averageUnitPrice: number;
  averageSellingPrice: number;
}

interface SalesResult {
  success: boolean;
  range: string;
  startDate: string;
  endDate: string;
  data?: SalesData;
  error?: string;
}

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7days", label: "Past 7 Days" },
  { value: "30days", label: "Past 30 Days" },
  { value: "60days", label: "Past 60 Days" },
  { value: "ytd", label: "Year to Date" },
  { value: "lastyear", label: "Last Year" },
];

function formatCurrency(amount: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

export default function SalesWidget() {
  const [selectedRange, setSelectedRange] = useState<DateRange>("today");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SalesResult | null>(null);

  const fetchSalesData = async (range: DateRange) => {
    setLoading(true);
    setSelectedRange(range);

    try {
      const response = await fetch(`/api/sales?range=${range}`);
      const data = await response.json();
      setResult(data);
    } catch (err) {
      setResult({
        success: false,
        range,
        startDate: "",
        endDate: "",
        error: err instanceof Error ? err.message : "Network error occurred",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchSalesData(selectedRange);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Sales Overview</CardTitle>
          </div>
          {result && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
        <CardDescription>
          View your Amazon sales metrics for different time periods
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {DATE_RANGES.map(({ value, label }) => (
            <Button
              key={value}
              variant={selectedRange === value && result ? "default" : "outline"}
              size="sm"
              onClick={() => fetchSalesData(value)}
              disabled={loading}
            >
              {loading && selectedRange === value ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {label}
            </Button>
          ))}
        </div>

        {result?.success && result.data && (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground">
              {result.startDate === result.endDate
                ? result.startDate
                : `${result.startDate} to ${result.endDate}`}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <DollarSign className="h-4 w-4" />
                  <span className="text-sm font-medium">Total Sales</span>
                </div>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {formatCurrency(result.data.totalSales, result.data.currency)}
                </p>
              </div>

              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <ShoppingCart className="h-4 w-4" />
                  <span className="text-sm font-medium">Orders</span>
                </div>
                <p className="text-2xl font-bold">
                  {formatNumber(result.data.orderCount)}
                </p>
              </div>

              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Package className="h-4 w-4" />
                  <span className="text-sm font-medium">Units Sold</span>
                </div>
                <p className="text-2xl font-bold">
                  {formatNumber(result.data.unitCount)}
                </p>
              </div>

              <div className="rounded-lg border p-4 space-y-2 col-span-2 md:col-span-1">
                <div className="text-muted-foreground">
                  <span className="text-sm font-medium">Avg. Selling Price</span>
                </div>
                <p className="text-xl font-semibold">
                  {formatCurrency(result.data.averageSellingPrice, result.data.currency)}
                </p>
              </div>

              <div className="rounded-lg border p-4 space-y-2 col-span-2 md:col-span-2">
                <div className="text-muted-foreground">
                  <span className="text-sm font-medium">Avg. Unit Price</span>
                </div>
                <p className="text-xl font-semibold">
                  {formatCurrency(result.data.averageUnitPrice, result.data.currency)}
                </p>
              </div>
            </div>
          </div>
        )}

        {result?.success === false && (
          <div className="rounded-md bg-red-50 dark:bg-red-950/30 p-4 space-y-2">
            <p className="text-sm text-red-600 dark:text-red-400 font-medium">
              Failed to fetch sales data
            </p>
            <p className="text-sm text-red-600 dark:text-red-400 font-mono">
              {result.error}
            </p>
          </div>
        )}

        {!result && (
          <div className="rounded-md bg-muted p-4 text-center">
            <p className="text-sm text-muted-foreground">
              Select a time period above to view your sales data
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
