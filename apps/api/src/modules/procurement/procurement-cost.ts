import type { Prisma, PrismaClient } from '@prisma/client';
import type { ProcurementCostView } from '@exportpro/types';
import { D, type Dec } from '../costing/costing-calculator';

type Db = PrismaClient | Prisma.TransactionClient;
const m2 = (d: Dec) => d.toDecimalPlaces(2).toFixed(2);
export type SpoWithReceipts = Prisma.SupplierPurchaseOrderGetPayload<{
  include: { items: true; receipts: true };
}>;

/**
 * Single source of truth for actual procurement cost:
 *   accepted goods (accepted qty × PO unit price, taxes excluded — treated as recoverable)
 *   + PO packaging, inland transport, inspection and other charges.
 * Payments only settle the payable and are never added again; goods receipts
 * contribute quantities, not money. Shown as one derived line in profitability.
 */
export function procurementCost(
  spo: SpoWithReceipts,
  quoteEstimate: string | null,
): ProcurementCostView {
  const goods = spo.items.reduce(
    (s, i) =>
      s.plus(new D(i.acceptedQuantity.toString()).mul(i.unitPrice.toString())),
    new D(0),
  );
  const committedGoods = spo.items.reduce(
    (s, i) => s.plus(new D(i.quantity.toString()).mul(i.unitPrice.toString())),
    new D(0),
  );
  const received = spo.items.reduce(
    (s, i) =>
      s.plus(
        new D(i.receivedQuantity.toString())
          .minus(i.damagedQuantity.toString())
          .mul(i.unitPrice.toString()),
      ),
    new D(0),
  );
  const charges: [string, Prisma.Decimal | null][] = [
    ['Packaging', spo.packagingCost],
    ['Inland transport', spo.inlandTransportCost],
    ['Inspection', spo.inspectionCost],
    ['Other supplier-side charges', spo.otherCharges],
  ];
  const chargeSum = charges.reduce(
    (s, [, v]) => (v ? s.plus(v.toString()) : s),
    new D(0),
  );
  const missing: string[] = [];
  if (!['RECEIVED', 'COMPLETED'].includes(spo.status))
    missing.push(`${spo.spoNumber}: goods not fully received`);
  if (spo.receipts.some((r) => r.qualityStatus === 'PENDING'))
    missing.push(`${spo.spoNumber}: quality inspection pending`);
  if (spo.receipts.some((r) => r.qualityStatus === 'HOLD'))
    missing.push(`${spo.spoNumber}: goods on quality hold`);
  return {
    currency: spo.currency,
    quoteEstimate,
    committed: m2(committedGoods.plus(chargeSum)),
    receivedValue: m2(received),
    actual: goods.gt(0) ? m2(goods.plus(chargeSum)) : null,
    components: [
      {
        label: 'Accepted goods (excl. tax)',
        amount: m2(goods),
        basis: 'accepted quantity × PO unit price',
      },
      ...charges.map(([label, v]) => ({
        label,
        amount: v ? m2(new D(v.toString())) : null,
        basis: v ? 'Supplier PO' : 'not stated on the PO',
      })),
      {
        label: 'Taxes (GST)',
        amount: spo.taxAmount ? m2(new D(spo.taxAmount.toString())) : null,
        basis:
          'excluded from cost (treated as recoverable; not tax accounting)',
      },
    ],
    complete: missing.length === 0 && goods.gt(0),
    missing,
    basis:
      'Supplier PO terms + accepted goods receipts. Supplier payments are not added again.',
  };
}

/** Supplier POs linked to a shipment: explicitly, or via its buyer PO when that PO has a single shipment. */
export async function linkedSupplierPos(
  db: Db,
  org: string,
  shipment: { id: string; purchaseOrderId: string },
) {
  const siblings = await db.shipment.count({
    where: {
      organizationId: org,
      purchaseOrderId: shipment.purchaseOrderId,
      status: { not: 'CANCELLED' },
    },
  });
  return db.supplierPurchaseOrder.findMany({
    where: {
      organizationId: org,
      status: { notIn: ['DRAFT', 'CANCELLED'] },
      OR: [
        { shipmentId: shipment.id },
        ...(siblings === 1
          ? [
              {
                buyerPurchaseOrderId: shipment.purchaseOrderId,
                shipmentId: null,
              },
            ]
          : []),
      ],
    },
    include: { items: true, receipts: true },
    orderBy: { createdAt: 'asc' },
  });
}
