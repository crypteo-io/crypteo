"use client";

import { DashboardError, type DashboardErrorProps } from "@/components/layout/DashboardError";

export default function AdminDashboardError(props: DashboardErrorProps) {
  return <DashboardError {...props} area="admin" />;
}
