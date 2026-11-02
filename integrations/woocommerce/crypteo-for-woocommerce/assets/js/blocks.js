( function ( wc, wp ) {
	var settings = wc.wcSettings.getSetting( 'crypteo_data', {} );
	var el = wp.element.createElement;
	var decode = wp.htmlEntities.decodeEntities;
	var title = decode( settings.title || '' );

	var Content = function () {
		return el( 'p', { className: 'crypteo-blocks-description' }, decode( settings.description || '' ) );
	};

	var Label = function () {
		return el(
			'span',
			{ className: 'crypteo-blocks-label' },
			settings.icon ? el( 'img', { src: settings.icon, alt: '', className: 'crypteo-icon' } ) : null,
			title
		);
	};

	wc.wcBlocksRegistry.registerPaymentMethod( {
		name: 'crypteo',
		label: el( Label ),
		content: el( Content ),
		edit: el( Content ),
		canMakePayment: function () {
			return true;
		},
		ariaLabel: title,
		supports: { features: settings.supports || [] },
	} );
} )( window.wc, window.wp );
