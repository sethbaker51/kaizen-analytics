import ConnectionTestCard from "@/components/ConnectionTestCard";

export default function Settings() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Manage your Amazon SP-API connection and preferences
        </p>
      </div>

      <ConnectionTestCard />
    </div>
  );
}
