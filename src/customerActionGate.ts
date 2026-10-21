/** A confirmation and its save share one reservation per customer. */
export type CustomerActionReservation = { readonly customerId: string };
export class CustomerActionGate {
  private active = new Map<string, { reservation: CustomerActionReservation; saving: boolean }>();

  reserve(customerId: string): CustomerActionReservation | null {
    if (this.active.has(customerId)) return null;
    const reservation = { customerId };
    this.active.set(customerId, { reservation, saving: false });
    return reservation;
  }

  confirm(reservation: CustomerActionReservation): boolean {
    const current = this.active.get(reservation.customerId);
    if (current?.reservation !== reservation || current.saving) return false;
    current.saving = true;
    return true;
  }

  cancel(reservation: CustomerActionReservation) {
    const current = this.active.get(reservation.customerId);
    if (current?.reservation === reservation && !current.saving)
      this.active.delete(reservation.customerId);
  }

  finish(reservation: CustomerActionReservation) {
    if (this.active.get(reservation.customerId)?.reservation === reservation)
      this.active.delete(reservation.customerId);
  }
}
