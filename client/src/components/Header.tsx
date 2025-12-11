import { BarChart3 } from "lucide-react";

export default function Header() {
  return (
    <header className="h-16 border-b flex items-center px-4 md:px-8 bg-card" data-testid="header">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-6 w-6 text-primary" />
        <span className="text-lg font-semibold" data-testid="text-brand-name">Kaizen Analytics</span>
      </div>
    </header>
  );
}
