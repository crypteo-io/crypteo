/* The on-site checkout. Every value is written with textContent. */
( function () {
	'use strict';

	var config = window.crypteoPay;
	var root = document.getElementById( 'crypteo-pay' );
	if ( ! config || ! root ) {
		return;
	}

	var text = config.i18n;
	var SEARCH_FROM = 7;
	var clockTimer = null;
	var lastView = '';
	var choosing = false;

	function el( tag, className, content ) {
		var node = document.createElement( tag );
		if ( className ) {
			node.className = className;
		}
		if ( undefined !== content ) {
			node.textContent = content;
		}
		return node;
	}

	function endpoint() {
		return config.url + ( -1 === config.url.indexOf( '?' ) ? '?' : '&' ) + 'key=' + encodeURIComponent( config.key );
	}

	function call( options ) {
		return fetch( endpoint(), options ).then( function ( response ) {
			if ( ! response.ok ) {
				throw new Error( 'request failed' );
			}
			return response.json();
		} );
	}

	function notice( message, link ) {
		var box = el( 'div', 'crypteo-pay__notice', message );
		if ( link ) {
			var anchor = el( 'a', 'button', link.label );
			anchor.href = link.url;
			box.appendChild( el( 'br' ) );
			box.appendChild( anchor );
		}
		return box;
	}

	function select( coin ) {
		lastView = '';
		choosing = false;
		call( {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify( { chain: coin.chain, token: coin.token } ),
		} ).then( render ).catch( function () {
			root.insertBefore( notice( text.failed ), root.firstChild );
		} );
	}

	function coinList( state ) {
		var box = el( 'div' );
		box.appendChild( el( 'h3', '', text.choose ) );
		if ( ! state.coins.length ) {
			box.appendChild( notice( text.noCoins ) );
			return box;
		}

		var list = el( 'div', 'crypteo-pay__coins' );
		function fill( query ) {
			list.textContent = '';
			var shown = state.coins.filter( function ( coin ) {
				return ( coin.asset + ' ' + coin.network + ' ' + coin.token ).toLowerCase().indexOf( query ) !== -1;
			} );
			shown.forEach( function ( coin ) {
				var button = el( 'button', 'crypteo-pay__coin' );
				button.type = 'button';
				button.appendChild( el( 'strong', '', coin.asset ) );
				if ( coin.network !== coin.asset ) {
					button.appendChild( el( 'span', '', coin.network ) );
				}
				button.addEventListener( 'click', function () {
					select( coin );
				} );
				list.appendChild( button );
			} );
			if ( ! shown.length ) {
				list.appendChild( el( 'p', '', text.noMatch ) );
			}
		}

		if ( state.coins.length >= SEARCH_FROM ) {
			var search = el( 'input', 'crypteo-pay__search input-text' );
			search.type = 'search';
			search.placeholder = text.search;
			search.setAttribute( 'aria-label', text.search );
			search.addEventListener( 'input', function () {
				fill( search.value.trim().toLowerCase() );
			} );
			box.appendChild( search );
		}
		fill( '' );
		box.appendChild( list );
		return box;
	}

	function copyRow( label, value ) {
		var row = el( 'div', 'crypteo-pay__row' );
		row.appendChild( el( 'span', 'crypteo-pay__label', label ) );
		var line = el( 'div', 'crypteo-pay__value' );
		line.appendChild( el( 'code', '', value ) );
		var button = el( 'button', 'crypteo-pay__copy', text.copy );
		button.type = 'button';
		button.addEventListener( 'click', function () {
			navigator.clipboard.writeText( value ).then( function () {
				button.textContent = text.copied;
				setTimeout( function () {
					button.textContent = text.copy;
				}, 1500 );
			} );
		} );
		line.appendChild( button );
		row.appendChild( line );
		return row;
	}

	function qrImage( value ) {
		var qr = window.qrcode( 0, 'M' );
		qr.addData( value, 'Byte' );
		qr.make();
		var image = el( 'img', 'crypteo-pay__qr' );
		image.src = qr.createDataURL( 5, 8 );
		image.alt = '';
		return image;
	}

	function clock( expiresAt, node ) {
		clearInterval( clockTimer );
		function tick() {
			var left = Math.max( 0, Math.floor( ( expiresAt - Date.now() ) / 1000 ) );
			var seconds = left % 60;
			node.textContent = Math.floor( left / 60 ) + ':' + ( seconds < 10 ? '0' : '' ) + seconds;
		}
		tick();
		clockTimer = setInterval( tick, 1000 );
	}

	function details( state ) {
		var box = el( 'div', 'crypteo-pay__details' );
		var status = { confirming: text.confirming, underpaid: text.underpaid }[ state.status ] || text.waiting;
		box.appendChild( el( 'p', 'crypteo-pay__status', status ) );

		var amount = copyRow( text.sendExact, state.amount + ' ' + state.token );
		var label = amount.querySelector( '.crypteo-pay__label' );
		var info = el( 'span', 'crypteo-pay__info', 'i' );
		info.title = text.feeNote;
		info.setAttribute( 'aria-label', text.feeNote );
		info.tabIndex = 0;
		label.appendChild( info );
		box.appendChild( amount );
		box.appendChild( copyRow( text.to, state.address ) );
		if ( state.tag ) {
			box.appendChild( copyRow( text.tag, state.tag ) );
		}
		if ( state.memo ) {
			box.appendChild( copyRow( text.memo, state.memo ) );
		}
		box.appendChild( el( 'p', 'crypteo-pay__fee', text.feeNote ) );
		if ( state.uri ) {
			box.appendChild( qrImage( state.uri ) );
		}

		var timer = el( 'p', 'crypteo-pay__timer' );
		timer.appendChild( el( 'span', '', text.timeLeft + ' ' ) );
		var time = el( 'strong' );
		timer.appendChild( time );
		box.appendChild( timer );
		clock( state.expiresAt, time );

		if ( state.isTest && config.testUrl ) {
			box.appendChild( notice( text.test, { url: config.testUrl, label: text.testLink } ) );
		}
		if ( 'pending' === state.status ) {
			var change = el( 'button', 'crypteo-pay__change', text.change );
			change.type = 'button';
			change.addEventListener( 'click', function () {
				choosing = true;
				render( state );
			} );
			box.appendChild( change );
		}
		return box;
	}

	function render( state ) {
		if ( state.paid ) {
			window.location.assign( state.doneUrl );
			return;
		}
		// Polls that change nothing leave the page alone, so a search or a selection survives.
		var pick = ! state.chain || ( choosing && 'pending' === state.status );
		var view = JSON.stringify( [ state.status, state.chain, state.amount, pick ] );
		if ( view === lastView ) {
			return;
		}
		lastView = view;
		root.textContent = '';

		if ( 'expired_received' === state.status ) {
			root.appendChild( notice( text.review ) );
		} else if ( 'expired' === state.status ) {
			root.appendChild( notice( text.expired, { url: state.retryUrl, label: text.retry } ) );
		} else if ( pick ) {
			root.appendChild( coinList( state ) );
		} else {
			root.appendChild( details( state ) );
		}
	}

	function poll() {
		if ( ! document.hidden ) {
			call().then( render ).catch( function () {} );
		}
		setTimeout( poll, config.pollMs );
	}

	call().then( function ( state ) {
		render( state );
		setTimeout( poll, config.pollMs );
	} ).catch( function () {
		root.textContent = '';
		root.appendChild( notice( text.failed ) );
	} );
}() );
