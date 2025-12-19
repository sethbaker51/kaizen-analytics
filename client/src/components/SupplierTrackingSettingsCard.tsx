import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings, Save, Loader2, AlertCircle } from "lucide-react";

interface SupplierTrackingSettings {
  id: string;
  inTransitThresholdDays: number;
  noTrackingThresholdDays: number;
  autoFlagOverdue: boolean;
  autoFlagCancelled: boolean;
  autoFlagNoTracking: boolean;
  updatedAt: string;
}

export default function SupplierTrackingSettingsCard() {
  const [settings, setSettings] = useState<SupplierTrackingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local form state
  const [inTransitDays, setInTransitDays] = useState(7);
  const [noTrackingDays, setNoTrackingDays] = useState(3);
  const [autoFlagOverdue, setAutoFlagOverdue] = useState(true);
  const [autoFlagCancelled, setAutoFlagCancelled] = useState(true);
  const [autoFlagNoTracking, setAutoFlagNoTracking] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/supplier-tracking/settings");
      const data = await response.json();
      if (data.success) {
        setSettings(data.data);
        setInTransitDays(data.data.inTransitThresholdDays);
        setNoTrackingDays(data.data.noTrackingThresholdDays);
        setAutoFlagOverdue(data.data.autoFlagOverdue);
        setAutoFlagCancelled(data.data.autoFlagCancelled);
        setAutoFlagNoTracking(data.data.autoFlagNoTracking);
      }
    } catch (err) {
      setError("Failed to load settings");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/supplier-tracking/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inTransitThresholdDays: inTransitDays,
          noTrackingThresholdDays: noTrackingDays,
          autoFlagOverdue,
          autoFlagCancelled,
          autoFlagNoTracking,
        }),
      });

      const data = await response.json();
      if (data.success) {
        setSettings(data.data);
      } else {
        setError(data.error || "Failed to save settings");
      }
    } catch (err) {
      setError("Failed to save settings");
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    settings &&
    (inTransitDays !== settings.inTransitThresholdDays ||
      noTrackingDays !== settings.noTrackingThresholdDays ||
      autoFlagOverdue !== settings.autoFlagOverdue ||
      autoFlagCancelled !== settings.autoFlagCancelled ||
      autoFlagNoTracking !== settings.autoFlagNoTracking);

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Auto-Flag Settings</CardTitle>
          </div>
          {hasChanges && (
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save
            </Button>
          )}
        </div>
        <CardDescription>
          Configure automatic flagging rules for supplier orders
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {error && (
              <div className="rounded-md bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Threshold Settings */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Threshold Settings</h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="in-transit-days">
                    In Transit Alert (days)
                  </Label>
                  <Input
                    id="in-transit-days"
                    type="number"
                    min={1}
                    max={60}
                    value={inTransitDays}
                    onChange={(e) => setInTransitDays(parseInt(e.target.value) || 7)}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    Flag orders in transit longer than this
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="no-tracking-days">
                    No Tracking Alert (days)
                  </Label>
                  <Input
                    id="no-tracking-days"
                    type="number"
                    min={1}
                    max={30}
                    value={noTrackingDays}
                    onChange={(e) => setNoTrackingDays(parseInt(e.target.value) || 3)}
                    className="w-full"
                  />
                  <p className="text-xs text-muted-foreground">
                    Flag confirmed orders without tracking after this many days
                  </p>
                </div>
              </div>
            </div>

            {/* Auto-Flag Toggles */}
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Auto-Flag Rules</h4>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Flag overdue orders</p>
                    <p className="text-xs text-muted-foreground">
                      Orders past their expected delivery date
                    </p>
                  </div>
                  <Switch
                    checked={autoFlagOverdue}
                    onCheckedChange={setAutoFlagOverdue}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Flag cancelled orders</p>
                    <p className="text-xs text-muted-foreground">
                      Orders that have been cancelled by supplier
                    </p>
                  </div>
                  <Switch
                    checked={autoFlagCancelled}
                    onCheckedChange={setAutoFlagCancelled}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Flag missing tracking</p>
                    <p className="text-xs text-muted-foreground">
                      Confirmed orders without tracking number after threshold
                    </p>
                  </div>
                  <Switch
                    checked={autoFlagNoTracking}
                    onCheckedChange={setAutoFlagNoTracking}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
