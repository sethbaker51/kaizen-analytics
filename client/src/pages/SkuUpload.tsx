import { useState } from "react";
import CsvTemplateCard from "@/components/CsvTemplateCard";
import SkuUploadCard from "@/components/SkuUploadCard";
import UploadHistoryCard from "@/components/UploadHistoryCard";

export default function SkuUpload() {
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleUploadComplete = () => {
    // Trigger a refresh of the upload history
    setRefreshTrigger((prev) => prev + 1);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">SKU Upload</h1>
        <p className="text-muted-foreground mt-1">
          Upload CSV files to create SKU listings linked to existing Amazon ASINs
        </p>
      </div>

      <CsvTemplateCard />
      <SkuUploadCard onUploadComplete={handleUploadComplete} />
      <UploadHistoryCard refreshTrigger={refreshTrigger} />
    </div>
  );
}
