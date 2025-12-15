import { useState, useEffect } from "react";
import { Loader2, CheckCircle2, XCircle, AlertCircle, Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface SkuItem {
  id: string;
  sku: string;
  asin: string;
  price: string | null;
  quantity: number | null;
  condition: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

interface UploadDetails {
  id: string;
  filename: string;
  status: string;
  totalItems: number;
  successCount: number;
  errorCount: number;
  feedId: string | null;
  feedDocumentId: string | null;
  feedResult: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  items: SkuItem[];
}

interface UploadDetailsDialogProps {
  uploadId: string | null;
  onClose: () => void;
}

export default function UploadDetailsDialog({ uploadId, onClose }: UploadDetailsDialogProps) {
  const [details, setDetails] = useState<UploadDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uploadId) {
      setDetails(null);
      return;
    }

    const fetchDetails = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/sku-upload/${uploadId}`);
        const data = await response.json();

        if (!data.success) {
          setError(data.error || "Failed to load details");
          return;
        }

        setDetails(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load details");
      } finally {
        setLoading(false);
      }
    };

    fetchDetails();
  }, [uploadId]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="secondary">pending</Badge>;
      case "submitted":
        return <Badge variant="default">submitted</Badge>;
      case "success":
        return (
          <Badge variant="default" className="bg-green-600">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            success
          </Badge>
        );
      case "error":
        return (
          <Badge variant="destructive">
            <XCircle className="h-3 w-3 mr-1" />
            error
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getOverallStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
      case "validating":
      case "submitting":
        return <Badge variant="secondary">{status}</Badge>;
      case "processing":
        return (
          <Badge variant="default" className="bg-yellow-500">
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
            processing
          </Badge>
        );
      case "completed":
        return <Badge variant="default" className="bg-green-600">completed</Badge>;
      case "failed":
        return <Badge variant="destructive">failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <Dialog open={!!uploadId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Upload Details</DialogTitle>
          <DialogDescription>
            View the status and details of your SKU upload
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {details && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted/50 rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">Filename</p>
                <p className="font-medium">{details.filename}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p>{getOverallStatusBadge(details.status)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Uploaded</p>
                <p className="font-medium">{formatDate(details.createdAt)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Results</p>
                <p className="font-medium">
                  <span className="text-green-600">{details.successCount} success</span>
                  {" / "}
                  <span className="text-red-600">{details.errorCount} errors</span>
                  {" / "}
                  {details.totalItems} total
                </p>
              </div>
              {details.feedId && (
                <div className="col-span-2">
                  <p className="text-sm text-muted-foreground">Feed ID</p>
                  <p className="font-mono text-sm">{details.feedId}</p>
                </div>
              )}
              {(details.status === "completed" || details.status === "failed") && details.feedResult && (
                <div className="col-span-2 space-y-3">
                  {/* Human-readable summary */}
                  {(() => {
                    try {
                      const result = JSON.parse(details.feedResult);
                      const summary = result.summary;
                      const issues = result.issues || [];
                      const isSuccess = summary?.messagesAccepted > 0 && summary?.errors === 0;
                      const isDelete = details.filename.startsWith("delete-");

                      return (
                        <div className={`rounded-md p-4 ${isSuccess ? "bg-green-50 dark:bg-green-950/30" : "bg-red-50 dark:bg-red-950/30"}`}>
                          <div className="flex items-start gap-3">
                            {isSuccess ? (
                              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                            ) : (
                              <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5" />
                            )}
                            <div className="flex-1">
                              <p className={`font-medium ${isSuccess ? "text-green-800 dark:text-green-200" : "text-red-800 dark:text-red-200"}`}>
                                {isSuccess
                                  ? (isDelete ? "SKU Successfully Deleted" : "SKU Successfully Created")
                                  : "Processing Failed"
                                }
                              </p>
                              <div className={`text-sm mt-2 space-y-1 ${isSuccess ? "text-green-700 dark:text-green-300" : "text-red-700 dark:text-red-300"}`}>
                                <p>Processed: {summary?.messagesProcessed || 0}</p>
                                <p>Accepted: {summary?.messagesAccepted || 0}</p>
                                {summary?.messagesInvalid > 0 && (
                                  <p>Invalid: {summary.messagesInvalid}</p>
                                )}
                                {summary?.errors > 0 && (
                                  <p>Errors: {summary.errors}</p>
                                )}
                              </div>
                              {issues.length > 0 && (
                                <div className="mt-3 text-sm">
                                  <p className="font-medium text-red-800 dark:text-red-200">Issues:</p>
                                  <ul className="list-disc list-inside mt-1 space-y-1">
                                    {issues.slice(0, 5).map((issue: any, i: number) => (
                                      <li key={i} className="text-red-700 dark:text-red-300">
                                        {issue.sku && <span className="font-mono">[{issue.sku}]</span>} {issue.message}
                                      </li>
                                    ))}
                                    {issues.length > 5 && (
                                      <li className="text-red-700 dark:text-red-300">
                                        ...and {issues.length - 5} more issues
                                      </li>
                                    )}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    } catch {
                      return null;
                    }
                  })()}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      window.location.href = `/api/sku-upload/${details.id}/report`;
                    }}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Full Report (JSON)
                  </Button>
                </div>
              )}
              {details.errorMessage && (
                <div className="col-span-2">
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{details.errorMessage}</AlertDescription>
                  </Alert>
                </div>
              )}
            </div>

            {/* Items Table */}
            {details.items.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">SKU Items ({details.items.length})</p>
                <ScrollArea className="h-[300px] border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>ASIN</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Condition</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {details.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-mono">{item.sku}</TableCell>
                          <TableCell className="font-mono">{item.asin}</TableCell>
                          <TableCell>{item.price ? `$${item.price}` : "-"}</TableCell>
                          <TableCell>{item.quantity ?? "-"}</TableCell>
                          <TableCell>{item.condition || "new"}</TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              {getStatusBadge(item.status)}
                              {item.errorMessage && (
                                <span className="text-xs text-red-600">
                                  {item.errorMessage}
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
