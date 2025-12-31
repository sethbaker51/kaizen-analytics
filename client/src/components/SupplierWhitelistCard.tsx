import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Shield,
  Plus,
  Trash2,
  Pencil,
  Upload,
  Download,
  Loader2,
  Mail,
  Building2,
  Search,
  Sparkles,
  CheckCircle2,
  Package,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface WhitelistEntry {
  id: string;
  name: string;
  emailPattern: string;
  domain: string | null;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
}

interface DiscoveredSupplier {
  name: string;
  emailPattern: string;
  domain: string;
  emailCount: number;
  sampleSubjects: string[];
  sampleEmails: string[];
  alreadyWhitelisted: boolean;
  selected?: boolean;
}

export default function SupplierWhitelistCard() {
  const [entries, setEntries] = useState<WhitelistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<WhitelistEntry | null>(null);
  const [editEntry, setEditEntry] = useState<WhitelistEntry | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showDiscoverDialog, setShowDiscoverDialog] = useState(false);
  const [formData, setFormData] = useState({ name: "", emailPattern: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [importData, setImportData] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveredSuppliers, setDiscoveredSuppliers] = useState<DiscoveredSupplier[]>([]);
  const [addingDiscovered, setAddingDiscovered] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const fetchEntries = useCallback(async () => {
    try {
      const response = await fetch("/api/supplier-whitelist");
      const data = await response.json();
      if (data.success) {
        setEntries(data.data);
      }
    } catch (error) {
      console.error("Failed to fetch whitelist:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const handleToggle = async (entry: WhitelistEntry) => {
    try {
      const response = await fetch(`/api/supplier-whitelist/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !entry.isActive }),
      });

      if (response.ok) {
        setEntries((prev) =>
          prev.map((e) =>
            e.id === entry.id ? { ...e, isActive: !e.isActive } : e
          )
        );
        toast({
          title: entry.isActive ? "Supplier disabled" : "Supplier enabled",
          description: `${entry.name} has been ${entry.isActive ? "disabled" : "enabled"}.`,
        });
      }
    } catch (error) {
      toast({
        title: "Failed to update",
        description: "Could not update supplier status",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (entry: WhitelistEntry) => {
    try {
      const response = await fetch(`/api/supplier-whitelist/${entry.id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setEntries((prev) => prev.filter((e) => e.id !== entry.id));
        toast({
          title: "Supplier removed",
          description: `${entry.name} has been removed from the whitelist.`,
        });
      }
    } catch (error) {
      toast({
        title: "Failed to delete",
        description: "Could not remove supplier",
        variant: "destructive",
      });
    }
    setDeleteConfirm(null);
  };

  const handleSave = async () => {
    if (!formData.name || !formData.emailPattern) {
      toast({
        title: "Validation error",
        description: "Name and email pattern are required",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const url = editEntry
        ? `/api/supplier-whitelist/${editEntry.id}`
        : "/api/supplier-whitelist";
      const method = editEntry ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (data.success) {
        if (editEntry) {
          setEntries((prev) =>
            prev.map((e) => (e.id === editEntry.id ? data.data : e))
          );
          toast({ title: "Supplier updated", description: `${formData.name} has been updated.` });
        } else {
          setEntries((prev) => [...prev, data.data]);
          toast({ title: "Supplier added", description: `${formData.name} has been added to the whitelist.` });
        }
        setShowAddDialog(false);
        setEditEntry(null);
        setFormData({ name: "", emailPattern: "", notes: "" });
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      toast({
        title: "Failed to save",
        description: error instanceof Error ? error.message : "Could not save supplier",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((line) => line.trim());

      if (lines.length < 2) {
        toast({
          title: "Invalid file",
          description: "CSV file must have a header row and at least one data row",
          variant: "destructive",
        });
        return;
      }

      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const nameIdx = headers.indexOf("name");
      const patternIdx = headers.indexOf("email_pattern");
      const notesIdx = headers.indexOf("notes");

      if (nameIdx === -1 || patternIdx === -1) {
        toast({
          title: "Invalid file",
          description: "CSV must have 'name' and 'email_pattern' columns",
          variant: "destructive",
        });
        return;
      }

      const data = lines.slice(1).map((line) => {
        const values = line.split(",").map((v) => v.trim());
        return {
          name: values[nameIdx] || "",
          email_pattern: values[patternIdx] || "",
          notes: notesIdx !== -1 ? values[notesIdx] : "",
        };
      }).filter((row) => row.name && row.email_pattern);

      setImportData(data);
      setShowImportDialog(true);
    };
    reader.readAsText(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const response = await fetch("/api/supplier-whitelist/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: importData }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: "Import complete",
          description: `${result.data.success} suppliers imported, ${result.data.failed} failed`,
        });
        fetchEntries();
        setShowImportDialog(false);
        setImportData([]);
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: "Import failed",
        description: error instanceof Error ? error.message : "Could not import suppliers",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const handleDiscover = async () => {
    setDiscovering(true);
    setShowDiscoverDialog(true);
    setDiscoveredSuppliers([]);

    try {
      const response = await fetch("/api/gmail/discover-suppliers", {
        method: "POST",
      });

      const result = await response.json();

      if (result.success) {
        // Pre-select suppliers that aren't already whitelisted
        const suppliers = result.data.suppliers.map((s: DiscoveredSupplier) => ({
          ...s,
          selected: !s.alreadyWhitelisted,
        }));
        setDiscoveredSuppliers(suppliers);

        if (suppliers.length === 0) {
          toast({
            title: "No suppliers found",
            description: "No potential supplier emails were found in your inbox.",
          });
        }
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: "Discovery failed",
        description: error instanceof Error ? error.message : "Could not scan inbox",
        variant: "destructive",
      });
      setShowDiscoverDialog(false);
    } finally {
      setDiscovering(false);
    }
  };

  const toggleSupplierSelection = (domain: string) => {
    setDiscoveredSuppliers((prev) =>
      prev.map((s) =>
        s.domain === domain ? { ...s, selected: !s.selected } : s
      )
    );
  };

  const selectAllSuppliers = (selected: boolean) => {
    setDiscoveredSuppliers((prev) =>
      prev.map((s) => (s.alreadyWhitelisted ? s : { ...s, selected }))
    );
  };

  const handleAddDiscovered = async () => {
    const selectedSuppliers = discoveredSuppliers.filter((s) => s.selected && !s.alreadyWhitelisted);

    if (selectedSuppliers.length === 0) {
      toast({
        title: "No suppliers selected",
        description: "Please select at least one supplier to add.",
        variant: "destructive",
      });
      return;
    }

    setAddingDiscovered(true);
    try {
      const response = await fetch("/api/gmail/add-discovered-suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suppliers: selectedSuppliers }),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: "Suppliers added",
          description: `${result.data.added} suppliers added to whitelist.`,
        });
        fetchEntries();
        setShowDiscoverDialog(false);
        setDiscoveredSuppliers([]);
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      toast({
        title: "Failed to add suppliers",
        description: error instanceof Error ? error.message : "Could not add suppliers",
        variant: "destructive",
      });
    } finally {
      setAddingDiscovered(false);
    }
  };

  const openEditDialog = (entry: WhitelistEntry) => {
    setEditEntry(entry);
    setFormData({
      name: entry.name,
      emailPattern: entry.emailPattern,
      notes: entry.notes || "",
    });
    setShowAddDialog(true);
  };

  const openAddDialog = () => {
    setEditEntry(null);
    setFormData({ name: "", emailPattern: "", notes: "" });
    setShowAddDialog(true);
  };

  const selectedCount = discoveredSuppliers.filter((s) => s.selected && !s.alreadyWhitelisted).length;
  const selectableCount = discoveredSuppliers.filter((s) => !s.alreadyWhitelisted).length;

  const activeCount = entries.filter((e) => e.isActive).length;

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity"
          >
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">Supplier Whitelist</CardTitle>
            {entries.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {activeCount}/{entries.length} active
              </Badge>
            )}
            {isCollapsed ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {!isCollapsed && (
            <div className="flex gap-2 flex-wrap">
              <input
                type="file"
                ref={fileInputRef}
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                variant="default"
                size="sm"
                onClick={handleDiscover}
                disabled={discovering}
              >
                {discovering ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4 mr-1" />
                )}
                Discover Suppliers
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.open("/api/supplier-whitelist/template", "_blank")}
              >
                <Download className="h-4 w-4 mr-1" />
                Template
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-1" />
                Import
              </Button>
              <Button variant="outline" size="sm" onClick={openAddDialog}>
                <Plus className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
          )}
        </div>
        {!isCollapsed && (
          <CardDescription>
            Only emails from whitelisted suppliers will be tracked. Use "Discover Suppliers" to scan your inbox.
          </CardDescription>
        )}
      </CardHeader>
      {!isCollapsed && <CardContent>
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <Building2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="font-medium">No suppliers in whitelist</p>
            <p className="text-sm mt-1 mb-4">
              Click "Discover Suppliers" to scan your inbox and find suppliers automatically.
            </p>
            <Button onClick={handleDiscover} disabled={discovering}>
              {discovering ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Discover Suppliers
            </Button>
          </div>
        )}

        {entries.length > 0 && (
          <div className="space-y-3">
            {entries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card"
              >
                <div className="flex items-center gap-3">
                  <Switch
                    checked={entry.isActive}
                    onCheckedChange={() => handleToggle(entry)}
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{entry.name}</span>
                      {entry.isActive ? (
                        <Badge variant="default" className="text-xs">Active</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-xs">Disabled</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Mail className="h-3 w-3" />
                      <span>{entry.emailPattern}</span>
                    </div>
                    {entry.notes && (
                      <p className="text-xs text-muted-foreground mt-1">{entry.notes}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(entry)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleteConfirm(entry)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>}

      {/* Discovery Dialog */}
      <Dialog open={showDiscoverDialog} onOpenChange={setShowDiscoverDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-5 w-5" />
              Discover Suppliers
            </DialogTitle>
            <DialogDescription>
              {discovering
                ? "Scanning your inbox for supplier emails..."
                : discoveredSuppliers.length > 0
                ? "Select the suppliers you want to track. We found these based on order-related emails."
                : "No suppliers found in your inbox."}
            </DialogDescription>
          </DialogHeader>

          {discovering && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-muted-foreground">Scanning emails from the last 60 days...</p>
              <p className="text-sm text-muted-foreground mt-1">This may take a minute</p>
            </div>
          )}

          {!discovering && discoveredSuppliers.length > 0 && (
            <>
              <div className="flex items-center justify-between py-2 border-b">
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={selectedCount === selectableCount && selectableCount > 0}
                    onCheckedChange={(checked) => selectAllSuppliers(!!checked)}
                  />
                  <span className="text-sm font-medium">
                    Select All ({selectedCount} of {selectableCount} selected)
                  </span>
                </div>
                <Badge variant="outline">{discoveredSuppliers.length} found</Badge>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 py-2">
                {discoveredSuppliers.map((supplier) => (
                  <div
                    key={supplier.domain}
                    className={`flex items-start gap-3 p-3 rounded-lg border ${
                      supplier.alreadyWhitelisted
                        ? "bg-muted/50 opacity-60"
                        : supplier.selected
                        ? "bg-primary/5 border-primary/20"
                        : "bg-card"
                    }`}
                  >
                    <Checkbox
                      checked={supplier.selected || supplier.alreadyWhitelisted}
                      disabled={supplier.alreadyWhitelisted}
                      onCheckedChange={() => toggleSupplierSelection(supplier.domain)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{supplier.name}</span>
                        <Badge variant="secondary" className="text-xs">
                          <Package className="h-3 w-3 mr-1" />
                          {supplier.emailCount} emails
                        </Badge>
                        {supplier.alreadyWhitelisted && (
                          <Badge variant="default" className="text-xs">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Already added
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                        <Mail className="h-3 w-3" />
                        <span>{supplier.emailPattern}</span>
                      </div>
                      {supplier.sampleSubjects.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs text-muted-foreground mb-1">Sample emails:</p>
                          <ul className="text-xs text-muted-foreground space-y-0.5">
                            {supplier.sampleSubjects.slice(0, 2).map((subject, i) => (
                              <li key={i} className="truncate">• {subject}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setShowDiscoverDialog(false)}>
              Cancel
            </Button>
            {!discovering && discoveredSuppliers.length > 0 && (
              <Button
                onClick={handleAddDiscovered}
                disabled={addingDiscovered || selectedCount === 0}
              >
                {addingDiscovered && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add {selectedCount} Supplier{selectedCount !== 1 ? "s" : ""}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add/Edit Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editEntry ? "Edit Supplier" : "Add Supplier"}</DialogTitle>
            <DialogDescription>
              {editEntry
                ? "Update the supplier whitelist entry."
                : "Add a new supplier to the whitelist. Only emails matching this pattern will be tracked."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Supplier Name</Label>
              <Input
                id="name"
                placeholder="e.g., Amazon"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pattern">Email Pattern</Label>
              <Input
                id="pattern"
                placeholder="e.g., @amazon.com or orders@supplier.com"
                value={formData.emailPattern}
                onChange={(e) => setFormData({ ...formData, emailPattern: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Use @domain.com to match all emails from a domain, or a full email address for exact match.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                placeholder="e.g., Main wholesale supplier"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editEntry ? "Save Changes" : "Add Supplier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Preview Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import Suppliers</DialogTitle>
            <DialogDescription>
              Review the suppliers to be imported from your CSV file.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto border rounded-md">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Email Pattern</th>
                  <th className="text-left p-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {importData.map((row, i) => (
                  <tr key={i} className="border-t">
                    <td className="p-2">{row.name}</td>
                    <td className="p-2">{row.email_pattern}</td>
                    <td className="p-2 text-muted-foreground">{row.notes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">
            {importData.length} supplier(s) will be imported
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleImport} disabled={importing}>
              {importing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Import {importData.length} Suppliers
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Supplier</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove "{deleteConfirm?.name}" from the whitelist?
              Emails from this supplier will no longer be tracked unless there are other matching entries.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
