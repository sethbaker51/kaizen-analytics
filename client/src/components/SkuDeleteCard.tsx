import { useState, useCallback } from "react";
import { Trash2, Upload, Loader2, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface DeleteResult {
  closeFeedId: string;
  deleteFeedId: string;
  sku?: string;
  uploadId?: string;
  totalItems?: number;
}

type Status = "idle" | "submitting" | "success" | "error";

interface SkuDeleteCardProps {
  onDeleteComplete?: () => void;
}

export default function SkuDeleteCard({ onDeleteComplete }: SkuDeleteCardProps) {
  // Single delete state
  const [singleSku, setSingleSku] = useState("");
  const [singleStatus, setSingleStatus] = useState<Status>("idle");
  const [singleResult, setSingleResult] = useState<DeleteResult | null>(null);
  const [singleError, setSingleError] = useState("");

  // Bulk delete state
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkStatus, setBulkStatus] = useState<Status>("idle");
  const [bulkResult, setBulkResult] = useState<DeleteResult | null>(null);
  const [bulkError, setBulkError] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const resetSingleState = () => {
    setSingleSku("");
    setSingleStatus("idle");
    setSingleResult(null);
    setSingleError("");
  };

  const resetBulkState = () => {
    setBulkFile(null);
    setBulkStatus("idle");
    setBulkResult(null);
    setBulkError("");
  };

  const handleSingleDelete = async () => {
    if (!singleSku.trim()) return;

    setSingleStatus("submitting");
    setSingleError("");

    try {
      const response = await fetch("/api/sku/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: singleSku.trim() }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setSingleStatus("error");
        setSingleError(data.error || "Delete failed");
        return;
      }

      setSingleResult(data.data);
      setSingleStatus("success");
      onDeleteComplete?.();
    } catch (err) {
      setSingleStatus("error");
      setSingleError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleBulkFile = useCallback(async (selectedFile: File) => {
    if (!selectedFile.name.endsWith(".csv") && !selectedFile.name.endsWith(".tsv")) {
      setBulkStatus("error");
      setBulkError("Please select a CSV or TSV file");
      return;
    }

    setBulkFile(selectedFile);
    setBulkStatus("submitting");
    setBulkError("");

    try {
      const content = await selectedFile.text();

      const response = await fetch("/api/sku/delete-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvContent: content,
          filename: selectedFile.name,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setBulkStatus("error");
        setBulkError(data.error || "Bulk delete failed");
        return;
      }

      setBulkResult(data.data);
      setBulkStatus("success");
      onDeleteComplete?.();
    } catch (err) {
      setBulkStatus("error");
      setBulkError(err instanceof Error ? err.message : "Bulk delete failed");
    }
  }, [onDeleteComplete]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleBulkFile(droppedFile);
    }
  }, [handleBulkFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleBulkFile(selectedFile);
    }
  }, [handleBulkFile]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trash2 className="h-5 w-5" />
          Delete SKUs
        </CardTitle>
        <CardDescription>
          Delete single SKUs or bulk delete via CSV file
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="single">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="single">Single SKU</TabsTrigger>
            <TabsTrigger value="bulk">Bulk Delete</TabsTrigger>
          </TabsList>

          {/* Single SKU Delete */}
          <TabsContent value="single" className="space-y-4">
            {singleStatus === "idle" || singleStatus === "error" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="sku-input">SKU to Delete</Label>
                  <div className="flex gap-2">
                    <Input
                      id="sku-input"
                      placeholder="Enter SKU"
                      value={singleSku}
                      onChange={(e) => setSingleSku(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSingleDelete()}
                    />
                    <Button
                      variant="destructive"
                      onClick={handleSingleDelete}
                      disabled={!singleSku.trim()}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                </div>

                {singleStatus === "error" && (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{singleError}</AlertDescription>
                  </Alert>
                )}
              </>
            ) : singleStatus === "submitting" ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
                <span className="text-lg">Submitting delete request...</span>
              </div>
            ) : singleStatus === "success" && singleResult ? (
              <div className="space-y-4">
                <div className="rounded-md bg-green-50 dark:bg-green-950/30 p-4 flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                  <div>
                    <p className="font-medium text-green-800 dark:text-green-200">
                      Close and delete requests submitted
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                      SKU: {singleResult.sku}
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      Close Feed ID: {singleResult.closeFeedId}
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      Delete Feed ID: {singleResult.deleteFeedId}
                    </p>
                  </div>
                </div>
                <Button onClick={resetSingleState}>Delete Another SKU</Button>
              </div>
            ) : null}
          </TabsContent>

          {/* Bulk Delete */}
          <TabsContent value="bulk" className="space-y-4">
            {bulkStatus === "idle" || bulkStatus === "error" ? (
              <>
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>CSV Format</AlertTitle>
                  <AlertDescription>
                    Upload a CSV or TSV file with a <code className="font-mono bg-muted px-1 rounded">sku</code> column containing the SKUs to delete.
                  </AlertDescription>
                </Alert>

                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                    isDragging
                      ? "border-destructive bg-destructive/5"
                      : "border-muted-foreground/25 hover:border-destructive/50"
                  }`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => document.getElementById("bulk-delete-input")?.click()}
                >
                  <input
                    id="bulk-delete-input"
                    type="file"
                    accept=".csv,.tsv"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-lg font-medium">Drop your CSV file here</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    or click to browse
                  </p>
                </div>

                {bulkStatus === "error" && (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>{bulkError}</AlertDescription>
                  </Alert>
                )}
              </>
            ) : bulkStatus === "submitting" ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
                <span className="text-lg">Submitting bulk delete request...</span>
              </div>
            ) : bulkStatus === "success" && bulkResult ? (
              <div className="space-y-4">
                <div className="rounded-md bg-green-50 dark:bg-green-950/30 p-4 flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                  <div>
                    <p className="font-medium text-green-800 dark:text-green-200">
                      Close and delete requests submitted
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                      {bulkResult.totalItems} SKUs queued for close &amp; delete
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      Close Feed ID: {bulkResult.closeFeedId}
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      Delete Feed ID: {bulkResult.deleteFeedId}
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      Status: Processing
                    </p>
                  </div>
                </div>
                <Button onClick={resetBulkState}>Delete More SKUs</Button>
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
