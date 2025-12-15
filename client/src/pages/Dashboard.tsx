import SalesWidget from "@/components/SalesWidget";

export default function Dashboard() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">Sales Overview</h1>
        <p className="text-muted-foreground mt-1">
          Monitor your Amazon seller analytics
        </p>
      </div>

      <SalesWidget />
    </div>
  );
}
