import OrdersCard from "@/components/OrdersCard";

export default function Orders() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="text-muted-foreground mt-1">
          View and track your Amazon orders by date range
        </p>
      </div>

      <OrdersCard />
    </div>
  );
}
