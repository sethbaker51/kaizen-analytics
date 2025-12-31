import ConnectionTestCard from "@/components/ConnectionTestCard";
import GmailAccountsCard from "@/components/GmailAccountsCard";
import SupplierTrackingSettingsCard from "@/components/SupplierTrackingSettingsCard";
import SupplierWhitelistCard from "@/components/SupplierWhitelistCard";
import SyncLogsCard from "@/components/SyncLogsCard";

export default function Settings() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your connections and preferences
        </p>
      </div>

      <ConnectionTestCard />
      <GmailAccountsCard />
      <SupplierWhitelistCard />
      <SyncLogsCard />
      <SupplierTrackingSettingsCard />
    </div>
  );
}
