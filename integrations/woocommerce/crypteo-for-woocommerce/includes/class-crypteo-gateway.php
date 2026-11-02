<?php
defined( 'ABSPATH' ) || exit;

class Crypteo_Gateway extends WC_Payment_Gateway {

	const ID       = 'crypteo';
	const CURRENCY = 'USD';

	const META_PAYMENT_IDS  = '_crypteo_payment_ids';
	const META_CHECKOUT_URL = '_crypteo_checkout_url';
	const META_EXPIRES_AT   = '_crypteo_expires_at';
	const META_AMOUNT       = '_crypteo_amount';
	const META_EVENTS       = '_crypteo_events';

	const KEY_PATTERN = '/^(crypt|test)_[A-Za-z0-9]+$/';

	public function __construct() {
		$this->id                 = self::ID;
		$this->icon               = crypteo_wc_asset( 'images/icon.svg' );
		$this->has_fields         = false;
		$this->method_title       = __( 'Crypteo', 'crypteo-for-woocommerce' );
		$this->method_description = __( 'Non-custodial crypto payments: buyers pay your own wallets directly, and Crypteo only watches the chain. Use crypteo.io or point the plugin at your own self-hosted Crypteo.', 'crypteo-for-woocommerce' );
		$this->supports           = array( 'products' );

		$this->init_form_fields();
		$this->init_settings();

		$this->title       = $this->get_option( 'title' );
		$this->description = $this->get_option( 'description' );
		$this->enabled     = $this->get_option( 'enabled' );

		add_action( 'woocommerce_update_options_payment_gateways_' . $this->id, array( $this, 'process_admin_options' ) );
		add_action( 'woocommerce_thankyou_' . $this->id, array( $this, 'thankyou_page' ) );
	}

	public function init_form_fields() {
		$this->form_fields = array(
			'enabled'        => array(
				'title'   => __( 'Enable', 'crypteo-for-woocommerce' ),
				'type'    => 'checkbox',
				'label'   => __( 'Accept crypto payments with Crypteo', 'crypteo-for-woocommerce' ),
				'default' => 'no',
			),
			'title'          => array(
				'title'       => __( 'Title', 'crypteo-for-woocommerce' ),
				'type'        => 'safe_text',
				'description' => __( 'What buyers see at checkout.', 'crypteo-for-woocommerce' ),
				'default'     => __( 'Pay with crypto', 'crypteo-for-woocommerce' ),
				'desc_tip'    => true,
			),
			'description'    => array(
				'title'       => __( 'Description', 'crypteo-for-woocommerce' ),
				'type'        => 'textarea',
				'description' => __( 'Shown under the title at checkout.', 'crypteo-for-woocommerce' ),
				'default'     => __( 'Pay with BTC, ETH, USDC, USDT and more, straight to the shop\'s own wallet. You pick the network on the next page.', 'crypteo-for-woocommerce' ),
				'desc_tip'    => true,
			),
			'api_base_url'   => array(
				'title'       => __( 'API base URL', 'crypteo-for-woocommerce' ),
				'type'        => 'text',
				'description' => __( 'Leave as https://crypteo.io, or enter the address of your self-hosted Crypteo. It must use https (http is allowed for localhost only).', 'crypteo-for-woocommerce' ),
				'default'     => CRYPTEO_WC_DEFAULT_API_BASE,
			),
			'api_key'        => array(
				'title'       => __( 'API key', 'crypteo-for-woocommerce' ),
				'type'        => 'password',
				'description' => __( 'Create one in your Crypteo dashboard under API keys.', 'crypteo-for-woocommerce' ),
				'default'     => '',
			),
			'webhook_secret' => array(
				'title'       => __( 'Webhook signing secret', 'crypteo-for-woocommerce' ),
				'type'        => 'password',
				'description' => __( 'In your Crypteo dashboard under Settings, Webhooks. The plugin checks every webhook against it and ignores anything unsigned.', 'crypteo-for-woocommerce' ),
				'default'     => '',
			),
			'test_mode_note' => array(
				'title'       => __( 'Test mode', 'crypteo-for-woocommerce' ),
				'type'        => 'title',
				'description' => __( 'A key starting with test_ creates test checkouts you can click through without sending real funds. Test payments never send webhooks, so the order stays pending. Switch to a crypt_ key before you go live.', 'crypteo-for-woocommerce' ),
			),
		);
	}

	public function validate_api_key_field( $key, $value ) {
		$value = trim( wp_unslash( (string) $value ) );
		if ( '' !== $value && ! preg_match( self::KEY_PATTERN, $value ) ) {
			throw new Exception( esc_html__( 'That API key doesn\'t look right. Keys start with crypt_ (live) or test_ (test).', 'crypteo-for-woocommerce' ) );
		}
		return $value;
	}

	public function validate_api_base_url_field( $key, $value ) {
		$url = untrailingslashit( trim( wp_unslash( (string) $value ) ) );
		if ( '' === $url ) {
			return CRYPTEO_WC_DEFAULT_API_BASE;
		}
		if ( ! self::is_valid_base_url( $url ) ) {
			throw new Exception( esc_html__( 'The API base URL must be an https address, like https://crypteo.io. Plain http is only allowed for localhost.', 'crypteo-for-woocommerce' ) );
		}
		return esc_url_raw( $url, array( 'https', 'http' ) );
	}

	public static function is_valid_base_url( $url ) {
		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) || empty( $parts['host'] ) || isset( $parts['user'] ) || isset( $parts['query'] ) || isset( $parts['fragment'] ) ) {
			return false;
		}
		$scheme = strtolower( $parts['scheme'] ?? '' );
		$host   = strtolower( trim( $parts['host'], '[]' ) );
		$local  = in_array( $host, array( 'localhost', '127.0.0.1', '::1' ), true ) || '.localhost' === substr( $host, -10 );
		return 'https' === $scheme || ( 'http' === $scheme && $local );
	}

	public function admin_options() {
		if ( self::CURRENCY !== get_woocommerce_currency() ) {
			echo '<div class="notice notice-warning inline"><p>' . esc_html__( 'Crypteo checkouts are priced in US dollars, so the gateway only appears while your store currency is USD.', 'crypteo-for-woocommerce' ) . '</p></div>';
		}
		echo '<div class="crypteo-admin-box"><label for="crypteo-webhook-url">' . esc_html__( 'Webhook URL', 'crypteo-for-woocommerce' ) . '</label>'
			. '<input type="text" id="crypteo-webhook-url" class="large-text code" readonly value="' . esc_attr( self::webhook_url() ) . '" onfocus="this.select()" />'
			. '<p>' . esc_html__( 'Payments from this store already ask your Crypteo instance to send their webhooks here. Copy it if you also want it as an endpoint in your Crypteo settings, for example to check it with Send test.', 'crypteo-for-woocommerce' ) . '</p></div>';
		parent::admin_options();
	}

	public function is_available() {
		return parent::is_available()
			&& '' !== $this->get_option( 'api_key' )
			&& '' !== $this->get_option( 'webhook_secret' )
			&& self::CURRENCY === get_woocommerce_currency();
	}

	public function get_icon() {
		$icon = '<img src="' . esc_url( $this->icon ) . '" alt="" class="crypteo-icon" />';
		return apply_filters( 'woocommerce_gateway_icon', $icon, $this->id );
	}

	public function api() {
		$base = $this->get_option( 'api_base_url' );
		return new Crypteo_API( $this->get_option( 'api_key' ), self::is_valid_base_url( $base ) ? $base : CRYPTEO_WC_DEFAULT_API_BASE );
	}

	public static function webhook_url() {
		return rest_url( Crypteo_Webhook::ROUTE_NAMESPACE . Crypteo_Webhook::ROUTE );
	}

	public static function meta_list( WC_Order $order, $key ) {
		$value = $order->get_meta( $key );
		return is_array( $value ) ? $value : array();
	}

	public static function order_amount( WC_Order $order ) {
		return wc_format_decimal( $order->get_total(), 2 );
	}

	public function process_payment( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order || self::CURRENCY !== $order->get_currency() ) {
			return $this->failed( $order_id, 'order missing or not priced in USD' );
		}

		$open = $this->open_checkout_url( $order );
		if ( $open ) {
			return array(
				'result'   => 'success',
				'redirect' => $open,
			);
		}

		$amount = self::order_amount( $order );
		$fields = array(
			'amount'     => (float) $amount,
			'externalId' => (string) $order->get_id(),
			'webhookUrl' => self::webhook_url(),
			'successUrl' => $order->get_checkout_order_received_url(),
			'cancelUrl'  => $order->get_checkout_payment_url(),
			'metadata'   => array(
				'source'      => 'woocommerce',
				'orderId'     => $order->get_id(),
				'orderNumber' => $order->get_order_number(),
				'orderKey'    => $order->get_order_key(),
			),
		);
		if ( is_email( $order->get_billing_email() ) ) {
			$fields['customerEmail'] = $order->get_billing_email();
		}

		$payment = $this->api()->create_payment( $fields );
		if ( is_wp_error( $payment ) ) {
			return $this->failed( $order_id, $payment->get_error_message() );
		}

		$payment_id   = isset( $payment['id'] ) && is_string( $payment['id'] ) ? $payment['id'] : '';
		$checkout_url = isset( $payment['checkoutUrl'] ) && is_string( $payment['checkoutUrl'] ) ? esc_url_raw( $payment['checkoutUrl'], array( 'https', 'http' ) ) : '';
		if ( '' === $payment_id || '' === $checkout_url ) {
			return $this->failed( $order_id, 'create response had no payment id or checkout URL' );
		}

		$ids   = self::meta_list( $order, self::META_PAYMENT_IDS );
		$ids[] = $payment_id;
		$order->update_meta_data( self::META_PAYMENT_IDS, array_values( array_unique( $ids ) ) );
		$order->update_meta_data( self::META_CHECKOUT_URL, $checkout_url );
		$order->update_meta_data( self::META_EXPIRES_AT, isset( $payment['expiresAt'] ) ? (int) strtotime( (string) $payment['expiresAt'] ) : 0 );
		$order->update_meta_data( self::META_AMOUNT, $amount );
		/* translators: %s: Crypteo payment id */
		$order->add_order_note( sprintf( __( 'Crypteo checkout opened (payment %s).', 'crypteo-for-woocommerce' ), $payment_id ) );
		$order->save();

		return array(
			'result'   => 'success',
			'redirect' => $checkout_url,
		);
	}

	/**
	 * The order's checkout if it is still open for the same amount, so a buyer
	 * who comes back to pay doesn't open a second session for one order.
	 */
	private function open_checkout_url( WC_Order $order ) {
		$url     = (string) $order->get_meta( self::META_CHECKOUT_URL );
		$expires = (int) $order->get_meta( self::META_EXPIRES_AT );
		$same    = (string) $order->get_meta( self::META_AMOUNT ) === self::order_amount( $order );
		return '' !== $url && $same && $expires > time() + 5 * MINUTE_IN_SECONDS ? $url : '';
	}

	private function failed( $order_id, $reason ) {
		crypteo_wc_log( sprintf( 'Order %d: could not open a checkout: %s', $order_id, $reason ) );
		wc_add_notice( __( 'We couldn\'t start the crypto payment just now. Please try again in a moment, or choose another payment method.', 'crypteo-for-woocommerce' ), 'error' );
		return array( 'result' => 'failure' );
	}

	public function thankyou_page( $order_id ) {
		$order = wc_get_order( $order_id );
		if ( ! $order ) {
			return;
		}

		if ( $order->is_paid() ) {
			$message = __( 'Payment received, thank you. It went straight to the shop\'s wallet.', 'crypteo-for-woocommerce' );
		} elseif ( $order->has_status( 'on-hold' ) ) {
			$message = __( 'Your payment needs a quick look from the shop: it was short of the total, or it arrived after the checkout closed. They\'ll be in touch.', 'crypteo-for-woocommerce' );
		} elseif ( $order->has_status( array( 'failed', 'cancelled' ) ) ) {
			$message = __( 'The checkout closed before a payment arrived, so this order wasn\'t paid.', 'crypteo-for-woocommerce' );
		} else {
			$message = __( 'We\'re waiting for your payment to confirm on-chain. You\'ll get an email when the order is confirmed.', 'crypteo-for-woocommerce' );
		}

		echo '<p class="crypteo-order-status">' . esc_html( $message ) . '</p>';
	}
}
