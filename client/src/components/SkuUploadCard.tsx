import { useState, useCallback } from "react";
import { Upload, FileText, CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ValidationResult {
  totalRows: number;
  validRows: number;
  errorCount: number;
  errors: Array<{ row: number; errors: string[] }>;
  preview: Array<{
    sku: string;
    asin: string;
    price?: string;
    quantity?: number;
    condition?: string;
  }>;
}

interface SubmitResult {
  uploadId: string;
  feedId: string;
  totalItems: number;
  status: string;
}

type Status = "idle" | "reading" | "validating" | "previewing" | "submitting" | "success" | "error";

interface SkuUploadCardProps {
  onUploadComplete?: () => void;
}

export default function SkuUploadCard({ onUploadComplete }: SkuUploadCardProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [csvContent, setCsvContent] = useState<string>("");
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);

  const resetState = () => {
    setStatus("idle");
    setFile(null);
    setCsvContent("");
    setValidationResult(null);
    setSubmitResult(null);
    setErrorMessage("");
  };

  const handleFile = useCallback(async (selectedFile: File) => {
    if (!selectedFile.name.endsWith(".csv") && !selectedFile.name.endsWith(".tsv")) {
      setStatus("error");
      setErrorMessage("Please select a CSV or TSV file");
      return;
    }

    setFile(selectedFile);
    setStatus("reading");

    try {
      const content = await selectedFile.text();
      setCsvContent(content);
      setStatus("validating");

      // Validate with backend
      const response = await fetch("/api/sku-upload/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvContent: content }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setStatus("error");
        setErrorMessage(data.error || "Validation failed");
        return;
      }

      setValidationResult(data.data);
      setStatus("previewing");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Failed to read file");
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      handleFile(droppedFile);
    }
  }, [handleFile]);

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
      handleFile(selectedFile);
    }
  }, [handleFile]);

  const handleSubmit = async () => {
    if (!csvContent || !file) return;

    setStatus("submitting");

    try {
      const response = await fetch("/api/sku-upload/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvContent,
          filename: file.name,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setStatus("error");
        setErrorMessage(data.error || "Submission failed");
        return;
      }

      setSubmitResult(data.data);
      setStatus("success");
      onUploadComplete?.();
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Submission failed");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload SKUs</CardTitle>
        <CardDescription>
          Upload a CSV or TSV file to create SKU listings on Amazon
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Idle / Drop Zone */}
        {(status === "idle" || status === "error") && (
          <>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50"
              }`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => document.getElementById("file-input")?.click()}
            >
              <input
                id="file-input"
                type="file"
                accept=".csv,.tsv"
                className="hidden"
                onChange={handleFileSelect}
              />
              <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
              <p className="text-lg font-medium">Drop your CSV or TSV file here</p>
              <p className="text-sm text-muted-foreground mt-1">
                or click to browse
              </p>
            </div>

            {status === "error" && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}
          </>
        )}

        {/* Reading / Validating */}
        {(status === "reading" || status === "validating") && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
            <span className="text-lg">
              {status === "reading" ? "Reading file..." : "Validating..."}
            </span>
          </div>
        )}

        {/* Preview */}
        {status === "previewing" && validationResult && (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <FileText className="h-8 w-8 text-primary" />
              <div>
                <p className="font-medium">{file?.name}</p>
                <p className="text-sm text-muted-foreground">
                  {validationResult.validRows} valid rows of {validationResult.totalRows} total
                </p>
              </div>
            </div>

            {validationResult.errorCount > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{validationResult.errorCount} validation errors</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc list-inside mt-2">
                    {validationResult.errors.slice(0, 5).map((err, i) => (
                      <li key={i}>
                        Row {err.row}: {err.errors.join(", ")}
                      </li>
                    ))}
                    {validationResult.errorCount > 5 && (
                      <li>...and {validationResult.errorCount - 5} more errors</li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {validationResult.preview.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-2">Preview (first 5 rows)</p>
                <div className="border rounded-md overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>ASIN</TableHead>
                        <TableHead>Price</TableHead>
                        <TableHead>Qty</TableHead>
                        <TableHead>Condition</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {validationResult.preview.map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono">{row.sku}</TableCell>
                          <TableCell className="font-mono">{row.asin}</TableCell>
                          <TableCell>{row.price ? `$${row.price}` : "-"}</TableCell>
                          <TableCell>{row.quantity ?? "-"}</TableCell>
                          <TableCell>{row.condition || "new"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" onClick={resetState}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={validationResult.validRows === 0}
              >
                Submit {validationResult.validRows} SKUs to Amazon
              </Button>
            </div>
          </div>
        )}

        {/* Submitting */}
        {status === "submitting" && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary mr-3" />
            <span className="text-lg">Submitting to Amazon...</span>
          </div>
        )}

        {/* Success */}
        {status === "success" && submitResult && (
          <div className="space-y-4">
            <div className="rounded-md bg-green-50 dark:bg-green-950/30 p-4 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
              <div>
                <p className="font-medium text-green-800 dark:text-green-200">
                  Successfully submitted {submitResult.totalItems} SKUs
                </p>
                <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                  Feed ID: {submitResult.feedId}
                </p>
                <p className="text-sm text-green-700 dark:text-green-300">
                  Status: Processing
                </p>
              </div>
            </div>
            <Button onClick={resetState}>Upload Another File</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
