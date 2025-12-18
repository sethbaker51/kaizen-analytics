import InventoryCard from "@/components/InventoryCard";

export default function Inventory() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <p className="text-muted-foreground mt-1">
          View and manage your FBA inventory levels
        </p>
      </div>

      <InventoryCard />
    </div>
  );
}
