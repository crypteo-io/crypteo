<?php
defined( 'ABSPATH' ) || exit;

/**
 * Receives Crypteo webhooks. The signed body only says which payment
 * changed: the order is updated from a fresh GET /payments/{id}.
 */
class Crypteo_Webhook {

	const ROUTE_NAMESPACE = 'crypteo/v1';
	const ROUTE           = '/webhook';
	const EVENTS_KEPT     = 25;

	public static function register_route() {
		register_rest_route(
			self::ROUTE_NAMESPACE,
			self::ROUTE,
			array(
				'methods'             => 'POST',
				'callback'            => array( __CLASS__, 'handle' ),
				// Authenticated by the HMAC signature in handle().
				'permission_callback' => '__return_true',
			)
		);
	}

	public static function handle( WP_REST_Request $request ) {
		$gateway = self::gateway();
		if ( ! $gateway ) {
			return self::reply( 503, 'gateway unavailable' );
		}

		$raw       = $request->get_body();
		$secret    = (string) $gateway->get_option( 'webhook_secret' );
		$signature = trim( (string) $request->get_header( 'x-signature' ) );
		if ( '' === $secret || '' === $signature || ! hash_equals( hash_hmac( 'sha256', $raw, $secret ), $signature ) ) {
			return self::reply( 401, 'invalid signature' );
		}

		$event = json_decode( $raw, true );
		if ( ! is_array( $event ) || ! isset( $event['event'] ) || ! is_string( $event['event'] ) ) {
			return self::reply( 400, 'malformed body' );
		}
		if ( 0 !== strpos( $event['event'], 'payment.' ) ) {
			return self::reply( 200, 'ignored' );
		}

		$sent       = isset( $event['payment'] ) && is_array( $event['payment'] ) ? $event['payment'] : array();
		$payment_id = isset( $sent['id'] ) && is_string( $sent['id'] ) ? $sent['id'] : '';
		$order      = self::find_order( isset( $sent['externalId'] ) ? (string) $sent['externalId'] : '', $payment_id );
		if ( ! $order ) {
			return self::reply( 200, 'unknown order' );
		}

		$event_id = trim( (string) $request->get_header( 'x-webhook-id' ) );
		if ( '' === $event_id && isset( $event['eventId'] ) ) {
			$event_id = (string) $event['eventId'];
		}
		$seen = Crypteo_Gateway::meta_list( $order, Crypteo_Gateway::META_EVENTS );
		if ( '' !== $event_id && in_array( $event_id, $seen, true ) ) {
			return self::reply( 200, 'duplicate' );
		}

		$payment = $gateway->api()->get_payment( $payment_id );
		if ( is_wp_error( $payment ) ) {
			crypteo_wc_log( sprintf( 'Order %d: could not re-read payment %s: %s', $order->get_id(), $payment_id, $payment->get_error_message() ) );
			return self::reply( 503, 'payment lookup failed' );
		}
		if ( ( $payment['id'] ?? '' ) !== $payment_id || (string) ( $payment['externalId'] ?? '' ) !== (string) $order->get_id() ) {
			crypteo_wc_log( sprintf( 'Order %d: payment %s does not belong to this order, ignored.', $order->get_id(), $payment_id ) );
			return self::reply( 200, 'payment does not match order' );
		}

		self::apply( $order, $payment );

		// Only an event the API has caught up with is spent: a delivery that ran
		// ahead of the read must still count when it is retried.
		if ( '' !== $event_id && isset( $sent['status'], $payment['status'] ) && $sent['status'] === $payment['status'] ) {
			$seen[] = $event_id;
			$order->update_meta_data( Crypteo_Gateway::META_EVENTS, array_slice( $seen, -self::EVENTS_KEPT ) );
			$order->save();
		}

		return self::reply( 200, 'ok' );
	}

	private static function apply( WC_Order $order, array $payment ) {
		if ( $order->is_paid() ) {
			return;
		}

		$payment_id = (string) $payment['id'];
		$status     = isset( $payment['status'] ) ? (string) $payment['status'] : '';
		$received   = self::amount( $payment, 'receivedAmount' );
		$expected   = self::amount( $payment, 'expectedAmount' );

		if ( true === ( $payment['paid'] ?? false ) ) {
			if ( ! self::amount_matches( $order ) ) {
				$order->update_status( 'on-hold', __( 'Crypteo says this payment is paid, but the order total or currency changed after the checkout opened. Check it before you ship.', 'crypteo-for-woocommerce' ) );
				return;
			}
			$tx = isset( $payment['txHash'] ) && is_string( $payment['txHash'] ) ? sanitize_text_field( $payment['txHash'] ) : '';
			/* translators: 1: amount and token received, 2: transaction hash */
			$order->add_order_note( sprintf( __( 'Crypteo payment confirmed: %1$s received. Transaction: %2$s', 'crypteo-for-woocommerce' ), $received, '' !== $tx ? $tx : '–' ) );
			$order->payment_complete( $payment_id );
			return;
		}

		switch ( $status ) {
			case 'confirming':
				$order->add_order_note( __( 'Crypteo saw the payment on-chain and is waiting for confirmations.', 'crypteo-for-woocommerce' ) );
				return;
			case 'underpaid':
				/* translators: 1: amount received, 2: amount due */
				$note = sprintf( __( 'Underpaid: %1$s received of %2$s. The buyer can still top it up, and the order completes on its own if they do.', 'crypteo-for-woocommerce' ), $received, $expected );
				if ( $order->has_status( array( 'pending', 'failed' ) ) ) {
					$order->update_status( 'on-hold', $note );
				} else {
					$order->add_order_note( $note );
				}
				return;
			case 'expired':
				if ( $order->has_status( 'pending' ) ) {
					$order->update_status( 'failed', __( 'The Crypteo checkout expired with no payment.', 'crypteo-for-woocommerce' ) );
				}
				return;
			case 'expired_received':
				/* translators: %s: amount received */
				$note = sprintf( __( '%s arrived after the checkout expired and was not credited automatically. Review it before you fulfil or refund.', 'crypteo-for-woocommerce' ), $received );
				if ( $order->has_status( array( 'pending', 'failed', 'cancelled' ) ) ) {
					$order->update_status( 'on-hold', $note );
				} else {
					$order->add_order_note( $note );
				}
				return;
		}
	}

	/**
	 * Amounts in the API are token units once the buyer picks a network, so the
	 * check is that the order still costs what the checkout was opened for.
	 */
	private static function amount_matches( WC_Order $order ) {
		return Crypteo_Gateway::CURRENCY === $order->get_currency()
			&& (string) $order->get_meta( Crypteo_Gateway::META_AMOUNT ) === Crypteo_Gateway::order_amount( $order );
	}

	private static function amount( array $payment, $field ) {
		$value = isset( $payment[ $field ] ) && is_numeric( $payment[ $field ] ) ? wc_format_decimal( $payment[ $field ] ) : '0';
		$token = isset( $payment['token'] ) && is_string( $payment['token'] ) ? strtoupper( sanitize_text_field( $payment['token'] ) ) : 'USD';
		$chain = isset( $payment['chain'] ) && is_string( $payment['chain'] ) ? ' (' . sanitize_text_field( $payment['chain'] ) . ')' : '';
		return $value . ' ' . $token . $chain;
	}

	private static function find_order( $external_id, $payment_id ) {
		if ( '' === $payment_id || ! ctype_digit( $external_id ) ) {
			return null;
		}
		$order = wc_get_order( (int) $external_id );
		if ( ! $order || Crypteo_Gateway::ID !== $order->get_payment_method() ) {
			return null;
		}
		return in_array( $payment_id, Crypteo_Gateway::meta_list( $order, Crypteo_Gateway::META_PAYMENT_IDS ), true ) ? $order : null;
	}

	public static function gateway() {
		$gateways = WC()->payment_gateways() ? WC()->payment_gateways()->payment_gateways() : array();
		return isset( $gateways[ Crypteo_Gateway::ID ] ) ? $gateways[ Crypteo_Gateway::ID ] : null;
	}

	private static function reply( $status, $message ) {
		return new WP_REST_Response( array( 'message' => $message ), $status );
	}
}
