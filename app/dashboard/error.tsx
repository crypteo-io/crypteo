"use client";

import { DashboardError, type DashboardErrorProps } from "@/components/layout/DashboardError";

export default function MerchantDashboardError(props: DashboardErrorProps) {
  return <DashboardError {...props} area="merchant" />;
}
