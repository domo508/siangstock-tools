-- Optional internal staff/shift label for HQ invite management; never an identity claim.
ALTER TABLE store_order_invites ADD COLUMN label TEXT NOT NULL DEFAULT '';
