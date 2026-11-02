<?php
/**
 * Plugin Name:          Crypteo for WooCommerce
 * Plugin URI:           https://crypteo.io
 * Description:          Non-custodial crypto payments for WooCommerce. Buyers pay your own wallets directly, through crypteo.io or your own self-hosted Crypteo.
 * Version:              1.0.0
 * Author:               Crypteo
 * Author URI:           https://crypteo.io
 * License:              GPL-2.0-or-later
 * License URI:          https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:          crypteo-for-woocommerce
 * Requires at least:    6.2
 * Requires PHP:         7.4
 * Requires Plugins:     woocommerce
 * WC requires at least: 8.0
 * WC tested up to:      10.3
 */

defined( 'ABSPATH' ) || exit;

define( 'CRYPTEO_WC_VERSION', '1.0.0' );
define( 'CRYPTEO_WC_FILE', __FILE__ );
define( 'CRYPTEO_WC_DEFAULT_API_BASE', 'https://crypteo.io' );

add_action(
	'before_woocommerce_init',
	static function () {
		if ( class_exists( \Automattic\WooCommerce\Utilities\FeaturesUtil::class ) ) {
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', __FILE__, true );
			\Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'cart_checkout_blocks', __FILE__, true );
		}
	}
);

add_action( 'plugins_loaded', 'crypteo_wc_init' );

function crypteo_wc_init() {
	if ( ! class_exists( 'WC_Payment_Gateway' ) ) {
		return;
	}

	require_once __DIR__ . '/includes/class-crypteo-api.php';
	require_once __DIR__ . '/includes/class-crypteo-gateway.php';
	require_once __DIR__ . '/includes/class-crypteo-webhook.php';

	add_filter(
		'woocommerce_payment_gateways',
		static function ( $gateways ) {
			$gateways[] = 'Crypteo_Gateway';
			return $gateways;
		}
	);

	add_action( 'rest_api_init', array( 'Crypteo_Webhook', 'register_route' ) );

	add_action(
		'woocommerce_blocks_payment_method_type_registration',
		static function ( $registry ) {
			require_once __DIR__ . '/includes/class-crypteo-blocks.php';
			$registry->register( new Crypteo_Blocks() );
		}
	);

	add_action(
		'wp_enqueue_scripts',
		static function () {
			if ( is_checkout() ) {
				wp_enqueue_style( 'crypteo-checkout', crypteo_wc_asset( 'css/checkout.css' ), array(), CRYPTEO_WC_VERSION );
			}
		}
	);

	add_action(
		'admin_enqueue_scripts',
		static function () {
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only screen check.
			$section = isset( $_GET['section'] ) ? sanitize_key( wp_unslash( $_GET['section'] ) ) : '';
			if ( Crypteo_Gateway::ID === $section ) {
				wp_enqueue_style( 'crypteo-admin', crypteo_wc_asset( 'css/admin.css' ), array(), CRYPTEO_WC_VERSION );
			}
		}
	);

	add_filter(
		'plugin_action_links_' . plugin_basename( __FILE__ ),
		static function ( $links ) {
			$url = admin_url( 'admin.php?page=wc-settings&tab=checkout&section=' . Crypteo_Gateway::ID );
			array_unshift( $links, '<a href="' . esc_url( $url ) . '">' . esc_html__( 'Settings', 'crypteo-for-woocommerce' ) . '</a>' );
			return $links;
		}
	);
}

function crypteo_wc_asset( $path ) {
	return plugins_url( 'assets/' . $path, CRYPTEO_WC_FILE );
}

function crypteo_wc_log( $message, $level = 'error' ) {
	wc_get_logger()->log( $level, $message, array( 'source' => 'crypteo' ) );
}
