import { Download } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const CSV_COLUMNS = [
  { name: "sku", required: true, description: "Your unique seller SKU identifier" },
  { name: "asin", required: true, description: "Amazon ASIN to link your SKU to (e.g., B08N5WRWNW)" },
  { name: "price", required: true, description: "Listing price in USD (e.g., 19.99)" },
  { name: "quantity", required: true, description: "Available inventory count" },
  { name: "condition", required: false, description: "Item condition: new (default), used, or refurbished" },
  { name: "batteries_required", required: false, description: "Are batteries needed? true or false (default: false)" },
  { name: "are_batteries_included", required: false, description: "Are batteries included? true or false (default: false)" },
  { name: "supplier_declared_dg_hz_regulation", required: false, description: "Hazmat regulation (default: Not Applicable)" },
];

export default function CsvTemplateCard() {
  const handleDownloadTemplate = () => {
    window.location.href = "/api/sku-upload/template";
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>CSV Format</span>
          <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
            <Download className="h-4 w-4 mr-2" />
            Download Template
          </Button>
        </CardTitle>
        <CardDescription>
          Upload a CSV file to create FBA SKU listings linked to existing Amazon ASINs
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Column</TableHead>
              <TableHead>Required</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CSV_COLUMNS.map((col) => (
              <TableRow key={col.name}>
                <TableCell className="font-mono font-medium">{col.name}</TableCell>
                <TableCell>
                  {col.required ? (
                    <Badge variant="default">Required</Badge>
                  ) : (
                    <Badge variant="secondary">Optional</Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{col.description}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
