<?php
defined( 'ABSPATH' ) || exit;

/**
 * The checkout that stays on the store: the order's pay page shows the coin
 * list and payment details, and its script talks to these routes, which keep
 * the API key on the server. The order key in the page's URL is what lets a
 * guest read their own order. Nothing here changes an order: only the signed
 * webhook does.
 */
class Crypteo_Onsite {

	const ROUTE      = '/pay/(?P<order>\d+)';
	const CACHE_TTL  = 4;
	const POLL_MS    = 10000;
	const CACHE_KEY  = 'crypteo_pay_';
	const COIN_MATCH = '/^[a-z0-9]{1,16}$/';

	public static function register_routes() {
		register_rest_route(
			Crypteo_Webhook::ROUTE_NAMESPACE,
			self::ROUTE,
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( __CLASS__, 'state' ),
					'permission_callback' => array( __CLASS__, 'owns_order' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( __CLASS__, 'select' ),
					'permission_callback' => array( __CLASS__, 'owns_order' ),
				),
			)
		);
	}

	private static function order_for( WP_REST_Request $request ) {
		$order = wc_get_order( absint( $request['order'] ) );
		return $order && Crypteo_Gateway::ID === $order->get_payment_method() ? $order : null;
	}

	public static function owns_order( WP_REST_Request $request ) {
		$order = self::order_for( $request );
		$key   = (string) $request->get_param( 'key' );
		return $order && '' !== $key && hash_equals( $order->get_order_key(), $key );
	}

	private static function payment_id( WC_Order $order ) {
		$ids = Crypteo_Gateway::meta_list( $order, Crypteo_Gateway::META_PAYMENT_IDS );
		return (string) end( $ids );
	}

	public static function state( WP_REST_Request $request ) {
		return self::read( self::order_for( $request ), false );
	}

	public static function select( WP_REST_Request $request ) {
		$order   = self::order_for( $request );
		$gateway = Crypteo_Webhook::gateway();
		$chain   = strtolower( (string) $request->get_param( 'chain' ) );
		$token   = strtolower( (string) $request->get_param( 'token' ) );
		if ( ! $gateway || ! preg_match( self::COIN_MATCH, $chain ) || ! preg_match( self::COIN_MATCH, $token ) ) {
			return self::error( 400 );
		}

		$selected = $gateway->api()->select_coin( self::payment_id( $order ), $chain, $token );
		if ( is_wp_error( $selected ) ) {
			crypteo_wc_log( sprintf( 'Order %d: could not select %s on %s: %s', $order->get_id(), $token, $chain, $selected->get_error_message() ) );
			return self::error( 502 );
		}
		return self::read( $order, true );
	}

	private static function read( WC_Order $order, $fresh ) {
		$payment_id = self::payment_id( $order );
		$cache_key  = self::CACHE_KEY . md5( $payment_id );
		$payment    = $fresh ? false : get_transient( $cache_key );

		if ( ! is_array( $payment ) ) {
			$gateway = Crypteo_Webhook::gateway();
			$payment = $gateway && '' !== $payment_id ? $gateway->api()->get_checkout( $payment_id ) : new WP_Error( 'crypteo_unavailable', 'gateway or payment missing' );
			if ( is_wp_error( $payment ) ) {
				crypteo_wc_log( sprintf( 'Order %d: could not read the payment: %s', $order->get_id(), $payment->get_error_message() ) );
				return self::error( 502 );
			}
			set_transient( $cache_key, $payment, self::CACHE_TTL );
		}
		return rest_ensure_response( self::view( $order, $payment ) );
	}

	/** Only what the buyer's screen needs. */
	private static function view( WC_Order $order, array $payment ) {
		$text  = static fn( $key ) => isset( $payment[ $key ] ) && is_scalar( $payment[ $key ] ) ? (string) $payment[ $key ] : '';
		$coins = array();
		foreach ( (array) ( $payment['coins'] ?? array() ) as $coin ) {
			if ( isset( $coin['chain'], $coin['token'] ) ) {
				$coins[] = array(
					'chain'   => (string) $coin['chain'],
					'token'   => (string) $coin['token'],
					'asset'   => (string) ( $coin['asset'] ?? strtoupper( $coin['token'] ) ),
					'network' => (string) ( $coin['network'] ?? strtoupper( $coin['chain'] ) ),
				);
			}
		}
		return array(
			'status'    => $text( 'status' ),
			'paid'      => true === ( $payment['paid'] ?? false ),
			'chain'     => $text( 'chain' ),
			'token'     => strtoupper( $text( 'token' ) ),
			'address'   => $text( 'walletAddress' ),
			'amount'    => $text( 'amountDueText' ),
			'tag'       => $text( 'xrpDestinationTag' ),
			'memo'      => $text( 'solMemoString' ),
			'uri'       => $text( 'paymentUri' ),
			'expiresAt' => (int) strtotime( $text( 'expiresAt' ) ) * 1000,
			'isTest'    => true === ( $payment['isTest'] ?? false ),
			'coins'     => $coins,
			'doneUrl'   => $order->get_checkout_order_received_url(),
			'retryUrl'  => $order->get_checkout_payment_url(),
		);
	}

	private static function error( $status ) {
		return new WP_Error( 'crypteo_pay', __( 'Something went wrong. Please try again.', 'crypteo-for-woocommerce' ), array( 'status' => $status ) );
	}

	/** The pay page, filled in by assets/js/onsite.js. */
	public static function render( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return;
		}

		wp_enqueue_style( 'crypteo-onsite', crypteo_wc_asset( 'css/onsite.css' ), array(), CRYPTEO_WC_VERSION );
		wp_enqueue_script( 'crypteo-qrcode', crypteo_wc_asset( 'js/qrcode.js' ), array(), '1.4.4', true );
		wp_enqueue_script( 'crypteo-onsite', crypteo_wc_asset( 'js/onsite.js' ), array( 'crypteo-qrcode' ), CRYPTEO_WC_VERSION, true );
		wp_localize_script(
			'crypteo-onsite',
			'crypteoPay',
			array(
				'url'     => rest_url( Crypteo_Webhook::ROUTE_NAMESPACE . '/pay/' . $order->get_id() ),
				'key'     => $order->get_order_key(),
				'pollMs'  => self::POLL_MS,
				'testUrl' => (string) $order->get_meta( Crypteo_Gateway::META_CHECKOUT_URL ),
				'i18n'    => array(
					'choose'     => __( 'Choose how to pay', 'crypteo-for-woocommerce' ),
					'search'     => __( 'Search coins', 'crypteo-for-woocommerce' ),
					'noMatch'    => __( 'No coin matches that.', 'crypteo-for-woocommerce' ),
					'noCoins'    => __( 'This shop has no coins available right now.', 'crypteo-for-woocommerce' ),
					'sendExact'  => __( 'Send exactly', 'crypteo-for-woocommerce' ),
					'feeNote'    => __( 'Network fees are on top of this amount. If you send from an exchange, make sure the amount that arrives is the full figure.', 'crypteo-for-woocommerce' ),
					'to'         => __( 'To this address', 'crypteo-for-woocommerce' ),
					'tag'        => __( 'Destination tag', 'crypteo-for-woocommerce' ),
					'memo'       => __( 'Memo', 'crypteo-for-woocommerce' ),
					'copy'       => __( 'Copy', 'crypteo-for-woocommerce' ),
					'copied'     => __( 'Copied', 'crypteo-for-woocommerce' ),
					'change'     => __( 'Choose another coin', 'crypteo-for-woocommerce' ),
					'timeLeft'   => __( 'Time left', 'crypteo-for-woocommerce' ),
					'waiting'    => __( 'Waiting for your payment. This page updates on its own.', 'crypteo-for-woocommerce' ),
					'confirming' => __( 'Payment seen. Waiting for network confirmations.', 'crypteo-for-woocommerce' ),
					'underpaid'  => __( 'Part of the payment arrived. Send the rest below.', 'crypteo-for-woocommerce' ),
					'expired'    => __( 'This checkout has closed.', 'crypteo-for-woocommerce' ),
					'retry'      => __( 'Start again', 'crypteo-for-woocommerce' ),
					'review'     => __( 'Funds arrived after the checkout closed. The shop will review them.', 'crypteo-for-woocommerce' ),
					'failed'     => __( 'That didn\'t work. Please try again.', 'crypteo-for-woocommerce' ),
					'test'       => __( 'Test mode: no real funds. Simulate the payment on the test checkout.', 'crypteo-for-woocommerce' ),
					'testLink'   => __( 'Open the test checkout', 'crypteo-for-woocommerce' ),
				),
			)
		);

		echo '<div id="crypteo-pay" class="crypteo-pay" aria-live="polite"><p>' . esc_html__( 'Loading your payment details…', 'crypteo-for-woocommerce' ) . '</p></div>';
		echo '<noscript><p>' . esc_html__( 'Paying here needs JavaScript. Please turn it on, or choose another payment method.', 'crypteo-for-woocommerce' ) . '</p></noscript>';
	}
}
