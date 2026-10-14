<?php
/**
 * Plugin Name: GSR Community Link
 * Description: Adds a "Discuss with verified New Hampshire residents" box under each post, linking to that story's thread on GSR Community.
 * Version: 0.1.0
 * License: GPL-2.0-or-later
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const NHCL_OPTION  = 'nhcl_community_url';
const NHCL_DEFAULT = 'https://community.granitestatereport.com';

function nhcl_community_url() {
	$url = get_option( NHCL_OPTION, NHCL_DEFAULT );
	return untrailingslashit( esc_url_raw( $url ? $url : NHCL_DEFAULT ) );
}

// Discussion box at the end of single posts only (not pages, feeds, or archives).
function nhcl_append_box( $content ) {
	if ( ! is_singular( 'post' ) || ! in_the_loop() || ! is_main_query() ) {
		return $content;
	}
	$href = nhcl_community_url() . '/discuss?url=' . rawurlencode( get_permalink() );
	$box  = '<aside class="nhcl-box">'
		. '<p class="nhcl-title">Talk about this story on GSR Community</p>'
		. '<p class="nhcl-sub">Every member shows NH ID before posting. No bots, no out-of-state accounts.</p>'
		. '<a class="nhcl-button" href="' . esc_url( $href ) . '">Join the discussion</a>'
		. '</aside>';
	return $content . $box;
}
add_filter( 'the_content', 'nhcl_append_box', 20 );

function nhcl_styles() {
	if ( ! is_singular( 'post' ) ) {
		return;
	}
	echo '<style>
.nhcl-box{margin:2em 0 0;padding:1.1em 1.25em;border:1px solid currentColor;border-radius:8px}
.nhcl-title{margin:0 0 .25em;font-weight:700}
.nhcl-sub{margin:0 0 .8em;opacity:.8;font-size:.95em}
.nhcl-button{display:inline-block;padding:.55em 1em;border-radius:6px;background:#1f4e3d;color:#fff !important;text-decoration:none;font-weight:700}
</style>';
}
add_action( 'wp_head', 'nhcl_styles' );

// Settings > GSR Community: one field for the community app's address.
function nhcl_settings_init() {
	register_setting( 'nhcl', NHCL_OPTION, array( 'type' => 'string', 'sanitize_callback' => 'esc_url_raw', 'default' => NHCL_DEFAULT ) );
	add_settings_section( 'nhcl_main', '', '__return_false', 'nhcl' );
	add_settings_field(
		NHCL_OPTION,
		'Community app URL',
		function () {
			printf( '<input type="url" class="regular-text" name="%s" value="%s">', esc_attr( NHCL_OPTION ), esc_attr( nhcl_community_url() ) );
		},
		'nhcl',
		'nhcl_main'
	);
}
add_action( 'admin_init', 'nhcl_settings_init' );

function nhcl_settings_page() {
	add_options_page( 'GSR Community', 'GSR Community', 'manage_options', 'nhcl', function () {
		echo '<div class="wrap"><h1>GSR Community</h1><form method="post" action="options.php">';
		settings_fields( 'nhcl' );
		do_settings_sections( 'nhcl' );
		submit_button();
		echo '</form></div>';
	} );
}
add_action( 'admin_menu', 'nhcl_settings_page' );
