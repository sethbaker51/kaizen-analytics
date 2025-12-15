import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Eye, Loader2, Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import UploadDetailsDialog from "./UploadDetailsDialog";

interface SkuUpload {
  id: string;
  filename: string;
  status: string;
  totalItems: number;
  successCount: number;
  errorCount: number;
  feedId: string | null;
  feedResult: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UploadHistoryCardProps {
  refreshTrigger?: number;
}

export default function UploadHistoryCard({ refreshTrigger }: UploadHistoryCardProps) {
  const [uploads, setUploads] = useState<SkuUpload[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);

  const fetchUploads = useCallback(async () => {
    try {
      const response = await fetch("/api/sku-uploads");
      const data = await response.json();
      if (data.success) {
        setUploads(data.data);
      }
    } catch (err) {
      console.error("Failed to fetch uploads:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll for status updates on processing uploads
  const pollProcessingUploads = useCallback(async () => {
    const processingUploads = uploads.filter((u) => u.status === "processing");

    for (const upload of processingUploads) {
      try {
        const response = await fetch(`/api/sku-upload/${upload.id}/status`);
        const data = await response.json();
        if (data.success && data.data.status !== upload.status) {
          setUploads((prev) =>
            prev.map((u) => (u.id === upload.id ? data.data : u))
          );
        }
      } catch (err) {
        console.error(`Failed to poll status for ${upload.id}:`, err);
      }
    }
  }, [uploads]);

  useEffect(() => {
    fetchUploads();
  }, [fetchUploads, refreshTrigger]);

  // Poll every 5 seconds for processing uploads
  useEffect(() => {
    const hasProcessing = uploads.some((u) => u.status === "processing");
    if (!hasProcessing) return;

    const interval = setInterval(pollProcessingUploads, 5000);
    return () => clearInterval(interval);
  }, [uploads, pollProcessingUploads]);

  const getStatusBadge = (status: string) => {
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

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upload History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Upload History</span>
            <Button variant="ghost" size="sm" onClick={fetchUploads}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardTitle>
          <CardDescription>
            View and track your SKU upload submissions
          </CardDescription>
        </CardHeader>
        <CardContent>
          {uploads.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No uploads yet. Upload a CSV file to get started.
            </p>
          ) : (
            <div className="border rounded-md overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Success</TableHead>
                    <TableHead className="text-right">Errors</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uploads.map((upload) => (
                    <TableRow key={upload.id}>
                      <TableCell className="font-medium">{upload.filename}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(upload.createdAt)}
                      </TableCell>
                      <TableCell>{getStatusBadge(upload.status)}</TableCell>
                      <TableCell className="text-right">{upload.totalItems}</TableCell>
                      <TableCell className="text-right text-green-600">
                        {upload.successCount}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {upload.errorCount}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedUploadId(upload.id)}
                            title="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {upload.feedResult && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                window.location.href = `/api/sku-upload/${upload.id}/report`;
                              }}
                              title="Download processing report"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <UploadDetailsDialog
        uploadId={selectedUploadId}
        onClose={() => setSelectedUploadId(null)}
      />
    </>
  );
}
