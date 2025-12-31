import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  History,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  Loader2,
} from "lucide-react";

interface SyncLog {
  id: string;
  gmailAccountId: string | null;
  syncType: string;
  status: string;
  emailsProcessed: number;
  ordersCreated: number;
  ordersUpdated: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export default function SyncLogsCard() {
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const response = await fetch("/api/gmail/sync-logs?limit=10");
      const data = await response.json();
      if (data.success) {
        setLogs(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch sync logs:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    // Refresh logs every 30 seconds
    const interval = setInterval(fetchLogs, 30000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatDuration = (start: string, end: string | null) => {
    if (!end) return "In progress";
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    const durationMs = endTime - startTime;

    if (durationMs < 1000) return "<1s";
    if (durationMs < 60000) return `${Math.round(durationMs / 1000)}s`;
    return `${Math.round(durationMs / 60000)}m`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-green-600 text-white">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-600 text-white">
            <XCircle className="h-3 w-3 mr-1" />
            Failed
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-blue-600 text-white">
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            Running
          </Badge>
        );
      default:
        return (
          <Badge variant="secondary">
            {status}
          </Badge>
        );
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Sync Activity</CardTitle>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchLogs}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
        <CardDescription>
          Recent email sync operations
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && logs.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && logs.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No sync activity yet</p>
            <p className="text-sm mt-1">
              Connect a Gmail account to start syncing
            </p>
          </div>
        )}

        {logs.length > 0 && (
          <div className="space-y-3">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-start justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {getStatusBadge(log.status)}
                    <span className="text-sm text-muted-foreground">
                      {formatTime(log.startedAt)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({formatDuration(log.startedAt, log.completedAt)})
                    </span>
                  </div>
                  {log.status === "completed" && (
                    <p className="text-sm mt-1">
                      Processed {log.emailsProcessed} email{log.emailsProcessed !== 1 ? "s" : ""}
                      {log.ordersCreated > 0 && `, ${log.ordersCreated} new order${log.ordersCreated !== 1 ? "s" : ""}`}
                      {log.ordersUpdated > 0 && `, ${log.ordersUpdated} updated`}
                    </p>
                  )}
                  {log.status === "failed" && log.errorMessage && (
                    <div className="flex items-start gap-2 mt-1">
                      <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                      <p className="text-sm text-red-600 dark:text-red-400">
                        {log.errorMessage}
                      </p>
                    </div>
                  )}
                </div>
                <Badge variant="outline" className="ml-2">
                  {log.syncType}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
