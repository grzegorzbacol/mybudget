"use client";

import { useState } from "react";
import { Camera, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReceiptScanner } from "@/components/ReceiptScanner";
import { TransactionForm } from "@/components/transactions/TransactionForm";

/** Mobile capture: add a transaction or scan a receipt from any app screen. */
export function CaptureFab() {
  const [formOpen, setFormOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  return (
    <>
      <div className="fixed bottom-20 right-3 z-40 flex flex-col gap-2 md:hidden">
        <Button
          size="icon"
          variant="outline"
          className="h-12 w-12 rounded-full bg-background shadow-lg"
          onClick={() => setScannerOpen(true)}
          aria-label="Skanuj paragon"
        >
          <Camera className="h-5 w-5" />
        </Button>
        <Button
          size="icon"
          className="h-12 w-12 rounded-full shadow-lg"
          onClick={() => setFormOpen(true)}
          aria-label="Dodaj transakcję"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>
      <TransactionForm open={formOpen} onOpenChange={setFormOpen} />
      <ReceiptScanner open={scannerOpen} onOpenChange={setScannerOpen} />
    </>
  );
}
