import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
import {
  Mail,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface GmailAccount {
  id: string;
  email: string;
  syncEnabled: boolean;
  lastSyncAt: string | null;
  createdAt: string;
  tokenExpiry: string;
  isTokenExpired: boolean;
}

interface GmailStatus {
  configured: boolean;
}

interface SyncResult {
  accountId: string;
  email: string;
  emailsProcessed: number;
  ordersCreated: number;
  ordersUpdated: number;
  errors: string[];
  suppliersScanned: number;
  totalSuppliers: number;
}

export default function GmailAccountsCard() {
  const [accounts, setAccounts] = useState<GmailAccount[]>([]);
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<GmailAccount | null>(null);
  const { toast } = useToast();

  const fetchAccounts = useCallback(async () => {
    try {
      const response = await fetch("/api/gmail/accounts");
      const data = await response.json();
      if (data.success) {
        setAccounts(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch Gmail accounts:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/gmail/status");
      const data = await response.json();
      if (data.success) {
        setStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch Gmail status:", error);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchAccounts();

    // Check URL params for success/error messages
    const params = new URLSearchParams(window.location.search);
    const success = params.get("success");
    const error = params.get("error");

    if (success === "gmail_connected") {
      // Clear the URL params
      window.history.replaceState({}, "", window.location.pathname);
      fetchAccounts();
      toast({
        title: "Gmail account connected",
        description: "Your Gmail account has been successfully connected for order tracking.",
      });
    } else if (error) {
      window.history.replaceState({}, "", window.location.pathname);
      const errorMessages: Record<string, string> = {
        gmail_auth_denied: "Gmail authorization was denied",
        gmail_no_code: "No authorization code received",
        gmail_auth_failed: "Gmail authentication failed",
      };
      toast({
        title: "Connection failed",
        description: errorMessages[error] || "Failed to connect Gmail account",
        variant: "destructive",
      });
    }
  }, [fetchAccounts, fetchStatus, toast]);

  const handleConnect = () => {
    window.location.href = "/api/gmail/auth";
  };

  const handleToggleSync = async (account: GmailAccount) => {
    try {
      const response = await fetch(`/api/gmail/accounts/${account.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncEnabled: !account.syncEnabled }),
      });

      if (response.ok) {
        const newEnabled = !account.syncEnabled;
        setAccounts((prev) =>
          prev.map((a) =>
            a.id === account.id ? { ...a, syncEnabled: newEnabled } : a
          )
        );
        toast({
          title: newEnabled ? "Sync enabled" : "Sync disabled",
          description: `Email sync for ${account.email} has been ${newEnabled ? "enabled" : "disabled"}.`,
        });
      }
    } catch (error) {
      console.error("Failed to toggle sync:", error);
      toast({
        title: "Failed to update sync settings",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleDisconnect = async (account: GmailAccount) => {
    try {
      const response = await fetch(`/api/gmail/accounts/${account.id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setAccounts((prev) => prev.filter((a) => a.id !== account.id));
        toast({
          title: "Account disconnected",
          description: `${account.email} has been disconnected from order tracking.`,
        });
      } else {
        toast({
          title: "Disconnect failed",
          description: "Failed to disconnect the account. Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to disconnect account:", error);
      toast({
        title: "Disconnect failed",
        description: error instanceof Error ? error.message : "Failed to disconnect account",
        variant: "destructive",
      });
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleSyncNow = async (account: GmailAccount) => {
    setSyncing(account.id);
    try {
      const response = await fetch(`/api/gmail/accounts/${account.id}/sync`, {
        method: "POST",
      });

      const data = await response.json();

      if (response.ok && data.success) {
        await fetchAccounts();

        const result = data.data as SyncResult;
        const supplierInfo = result.totalSuppliers > 0
          ? `Scanned ${result.suppliersScanned} suppliers. `
          : "";

        if (result.errors.length > 0) {
          toast({
            title: "Sync completed with errors",
            description: `${supplierInfo}${result.ordersCreated} new orders, ${result.ordersUpdated} updated. ${result.errors.length} error(s).`,
            variant: "destructive",
          });
        } else if (result.ordersCreated > 0 || result.ordersUpdated > 0) {
          toast({
            title: "Sync completed",
            description: `${supplierInfo}Found ${result.ordersCreated} new orders, updated ${result.ordersUpdated}.`,
          });
        } else {
          toast({
            title: "Sync completed",
            description: result.totalSuppliers > 0
              ? `Scanned ${result.suppliersScanned} suppliers. No new orders found.`
              : "No new orders found. Add suppliers to the whitelist to start tracking.",
          });
        }
      } else {
        toast({
          title: "Sync failed",
          description: data.error || "Failed to sync emails",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to sync:", error);
      toast({
        title: "Sync failed",
        description: error instanceof Error ? error.message : "Failed to sync emails",
        variant: "destructive",
      });
    } finally {
      setSyncing(null);
    }
  };

  const formatLastSync = (date: string | null) => {
    if (!date) return "Never";
    const d = new Date(date);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <>
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Gmail Accounts</CardTitle>
            </div>
            {accounts.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleConnect}>
                <Plus className="h-4 w-4 mr-1" />
                Add Account
              </Button>
            )}
          </div>
          <CardDescription>
            Connect Gmail accounts to automatically track supplier order emails.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!status?.configured && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                <div>
                  <p className="font-medium text-amber-700 dark:text-amber-400">
                    Gmail API Not Configured
                  </p>
                  <p className="text-sm text-amber-600 dark:text-amber-500 mt-1">
                    Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables to enable Gmail integration.
                  </p>
                </div>
              </div>
            </div>
          )}

          {status?.configured && loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {status?.configured && !loading && accounts.length === 0 && (
            <div className="text-center py-8">
              <Mail className="h-12 w-12 mx-auto text-muted-foreground opacity-50 mb-4" />
              <p className="text-muted-foreground mb-4">
                No Gmail accounts connected yet
              </p>
              <Button onClick={handleConnect}>
                <Plus className="h-4 w-4 mr-2" />
                Connect Gmail Account
              </Button>
            </div>
          )}

          {status?.configured && !loading && accounts.length > 0 && (
            <div className="space-y-3">
              {accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Mail className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{account.email}</span>
                        {account.isTokenExpired && (
                          <Badge variant="destructive" className="text-xs">
                            Token Expired
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>Last sync: {formatLastSync(account.lastSyncAt)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">Sync</span>
                      <Switch
                        checked={account.syncEnabled}
                        onCheckedChange={() => handleToggleSync(account)}
                      />
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSyncNow(account)}
                      disabled={syncing === account.id || !account.syncEnabled}
                    >
                      {syncing === account.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCw className="h-4 w-4" />
                      )}
                    </Button>

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteConfirm(account)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {status?.configured && accounts.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground pt-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Emails are synced automatically every 5 minutes</span>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Gmail Account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove <strong>{deleteConfirm?.email}</strong> from supplier tracking.
              Existing orders from this account will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm && handleDisconnect(deleteConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
