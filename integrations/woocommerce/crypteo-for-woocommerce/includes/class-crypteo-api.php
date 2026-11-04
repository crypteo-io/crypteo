<?php
defined( 'ABSPATH' ) || exit;

/**
 * Client for the public merchant API (/api/public/v1). Returns the response's
 * `payment` object, or a WP_Error whose message never contains the key.
 */
class Crypteo_API {

	private $api_key;
	private $base_url;

	public function __construct( $api_key, $base_url ) {
		$this->api_key  = $api_key;
		$this->base_url = untrailingslashit( $base_url );
	}

	public function create_payment( array $fields ) {
		return $this->request( 'POST', '/payments', $fields );
	}

	public function get_payment( $payment_id ) {
		return $this->request( 'GET', '/payments/' . rawurlencode( $payment_id ) );
	}

	/** The payment plus the coins the buyer can still choose from, as `coins`. */
	public function get_checkout( $payment_id ) {
		$data = $this->send( 'GET', '/payments/' . rawurlencode( $payment_id ) );
		if ( is_wp_error( $data ) ) {
			return $data;
		}
		$coins = isset( $data['availableWallets'] ) && is_array( $data['availableWallets'] ) ? $data['availableWallets'] : array();
		return array_merge( $data['payment'], array( 'coins' => $coins ) );
	}

	public function select_coin( $payment_id, $chain, $token ) {
		return $this->request(
			'PATCH',
			'/payments/' . rawurlencode( $payment_id ),
			array(
				'chain' => $chain,
				'token' => $token,
			)
		);
	}

	private function request( $method, $path, $body = null ) {
		$data = $this->send( $method, $path, $body );
		return is_wp_error( $data ) ? $data : $data['payment'];
	}

	private function send( $method, $path, $body = null ) {
		$args = array(
			'method'      => $method,
			'timeout'     => 20,
			'redirection' => 0,
			'headers'     => array(
				'Authorization' => 'Bearer ' . $this->api_key,
				'Accept'        => 'application/json',
			),
		);
		if ( null !== $body ) {
			$args['headers']['Content-Type'] = 'application/json';
			$args['body']                    = wp_json_encode( $body );
		}

		$response = wp_remote_request( $this->base_url . '/api/public/v1' . $path, $args );
		if ( is_wp_error( $response ) ) {
			return new WP_Error( 'crypteo_http', sprintf( '%s %s failed: %s', $method, $path, $response->get_error_message() ) );
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$data   = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( $status < 200 || $status >= 300 || ! is_array( $data ) || empty( $data['payment'] ) || ! is_array( $data['payment'] ) ) {
			$error = is_array( $data ) && isset( $data['error'] ) && is_string( $data['error'] ) ? $data['error'] : 'unexpected response';
			return new WP_Error( 'crypteo_api', sprintf( '%s %s returned HTTP %d: %s', $method, $path, $status, $error ), array( 'status' => $status ) );
		}

		return $data;
	}
}
