import { useState } from "react";
import InboundOrdersCard from "@/components/InboundOrdersCard";
import SupplierOrderDetailDialog from "@/components/SupplierOrderDetailDialog";

interface SupplierOrder {
  id: string;
  gmailAccountId: string;
  emailMessageId: string;
  supplierName: string | null;
  supplierEmail: string | null;
  orderNumber: string | null;
  orderDate: string | null;
  expectedDeliveryDate: string | null;
  actualDeliveryDate: string | null;
  status: string;
  trackingNumber: string | null;
  carrier: string | null;
  totalCost: string | null;
  currency: string;
  notes: string | null;
  emailSubject: string | null;
  emailSnippet?: string | null;
  isFlagged: boolean;
  flagReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function InboundOrders() {
  const [selectedOrder, setSelectedOrder] = useState<SupplierOrder | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleViewOrder = (order: SupplierOrder) => {
    setSelectedOrder(order);
  };

  const handleOrderSaved = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const handleOrderDeleted = () => {
    setRefreshKey((prev) => prev + 1);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Inbound Orders</h1>
        <p className="text-muted-foreground mt-1">
          Track orders placed with your suppliers
        </p>
      </div>

      <InboundOrdersCard key={refreshKey} onViewOrder={handleViewOrder} />

      <SupplierOrderDetailDialog
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onSave={handleOrderSaved}
        onDelete={handleOrderDeleted}
      />
    </div>
  );
}
