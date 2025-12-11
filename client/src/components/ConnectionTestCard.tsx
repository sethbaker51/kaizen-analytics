import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShieldCheck, CheckCircle2, XCircle, Loader2 } from "lucide-react";

type ConnectionStatus = "idle" | "loading" | "success" | "error";

interface ConnectionResult {
  status: ConnectionStatus;
  message?: string;
  data?: Record<string, unknown>;
  timestamp?: string;
}

export default function ConnectionTestCard() {
  const [result, setResult] = useState<ConnectionResult>({ status: "idle" });

  const handleTestConnection = async () => {
    setResult({ status: "loading" });
    
    try {
      const response = await fetch("/api/test-connection");
      const data = await response.json();
      
      if (response.ok) {
        setResult({
          status: "success",
          message: "Connection Successful",
          data: data,
          timestamp: new Date().toLocaleString(),
        });
      } else {
        setResult({
          status: "error",
          message: data.error || "Connection Failed",
          data: data,
          timestamp: new Date().toLocaleString(),
        });
      }
    } catch (err) {
      setResult({
        status: "error",
        message: err instanceof Error ? err.message : "Network error occurred",
        timestamp: new Date().toLocaleString(),
      });
    }
  };

  return (
    <Card className="w-full" data-testid="card-connection-test">
      <CardHeader>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Test SP-API Connection</CardTitle>
        </div>
        <CardDescription>
          Verify your Amazon Seller Partner API credentials by testing the connection to the US marketplace.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          onClick={handleTestConnection}
          disabled={result.status === "loading"}
          data-testid="button-test-connection"
        >
          {result.status === "loading" ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Testing connection...
            </>
          ) : (
            "Test Connection"
          )}
        </Button>

        {result.status === "success" && (
          <div className="rounded-md bg-green-50 dark:bg-green-950/30 p-4 space-y-2" data-testid="status-success">
            <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-medium">{result.message}</span>
            </div>
            <p className="text-sm text-muted-foreground">{result.timestamp}</p>
            {result.data && (
              <pre className="mt-2 rounded-md bg-muted p-4 font-mono text-sm overflow-x-auto" data-testid="text-response-data">
                {JSON.stringify(result.data, null, 2)}
              </pre>
            )}
          </div>
        )}

        {result.status === "error" && (
          <div className="rounded-md bg-red-50 dark:bg-red-950/30 p-4 space-y-2" data-testid="status-error">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <XCircle className="h-5 w-5" />
              <span className="font-medium">Connection Failed</span>
            </div>
            <p className="text-sm text-muted-foreground">{result.timestamp}</p>
            <p className="text-sm text-red-600 dark:text-red-400 font-mono">{result.message}</p>
            {result.data && (
              <pre className="mt-2 rounded-md bg-muted p-4 font-mono text-sm overflow-x-auto" data-testid="text-error-details">
                {JSON.stringify(result.data, null, 2)}
              </pre>
            )}
          </div>
        )}

        {result.status === "idle" && (
          <div className="rounded-md bg-muted p-4 text-center" data-testid="status-idle">
            <p className="text-sm text-muted-foreground">
              Click the button above to test your SP-API connection
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
