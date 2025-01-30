// ==UserScript==
// @name         9now
// @description  Improve site usability. Watch videos in external player.
// @version      1.0.1
// @include      /^https?:\/\/(?:[^\.\/]*\.)*9now\.com\.au\/.+\/episode-\d+(?:[#\?].*)?$/
// @icon         https://www.9now.com.au/favicon.ico
// @run-at       document-end
// @grant        unsafeWindow
// @homepage     https://github.com/warren-bank/crx-9now/tree/webmonkey-userscript/es5
// @supportURL   https://github.com/warren-bank/crx-9now/issues
// @downloadURL  https://github.com/warren-bank/crx-9now/raw/webmonkey-userscript/es5/webmonkey-userscript/9now.user.js
// @updateURL    https://github.com/warren-bank/crx-9now/raw/webmonkey-userscript/es5/webmonkey-userscript/9now.user.js
// @namespace    warren-bank
// @author       Warren Bank
// @copyright    Warren Bank
// ==/UserScript==

// ----------------------------------------------------------------------------- user options

var user_options = {
  "webmonkey": {
    "post_intent_redirect_to_url":  "about:blank"
  },
  "greasemonkey": {
    "redirect_to_webcast_reloaded": true,
    "force_http":                   true,
    "force_https":                  false
  }
}

// ----------------------------------------------------------------------------- state

var state = {
  policy_key:   null,
  account_id:   null,
  reference_id: null
}

// ----------------------------------------------------------------------------- URL links to tools on Webcast Reloaded website

var get_webcast_reloaded_url = function(video_url, vtt_url, referer_url, force_http, force_https) {
  force_http  = (typeof force_http  === 'boolean') ? force_http  : user_options.greasemonkey.force_http
  force_https = (typeof force_https === 'boolean') ? force_https : user_options.greasemonkey.force_https

  var encoded_video_url, encoded_vtt_url, encoded_referer_url, webcast_reloaded_base, webcast_reloaded_url

  encoded_video_url     = encodeURIComponent(encodeURIComponent(btoa(video_url)))
  encoded_vtt_url       = vtt_url ? encodeURIComponent(encodeURIComponent(btoa(vtt_url))) : null
  referer_url           = referer_url ? referer_url : unsafeWindow.location.href
  encoded_referer_url   = encodeURIComponent(encodeURIComponent(btoa(referer_url)))

  webcast_reloaded_base = {
    "https": "https://warren-bank.github.io/crx-webcast-reloaded/external_website/index.html",
    "http":  "http://webcast-reloaded.surge.sh/index.html"
  }

  webcast_reloaded_base = (force_http)
                            ? webcast_reloaded_base.http
                            : (force_https)
                               ? webcast_reloaded_base.https
                               : (video_url.toLowerCase().indexOf('http:') === 0)
                                  ? webcast_reloaded_base.http
                                  : webcast_reloaded_base.https

  webcast_reloaded_url  = webcast_reloaded_base + '#/watch/' + encoded_video_url + (encoded_vtt_url ? ('/subtitle/' + encoded_vtt_url) : '') + '/referer/' + encoded_referer_url
  return webcast_reloaded_url
}

// ----------------------------------------------------------------------------- URL redirect

var redirect_to_url = function(url) {
  if (!url) return

  if (typeof GM_loadUrl === 'function') {
    if (typeof GM_resolveUrl === 'function')
      url = GM_resolveUrl(url, unsafeWindow.location.href) || url

    GM_loadUrl(url, 'Referer', unsafeWindow.location.href)
  }
  else {
    try {
      unsafeWindow.top.location = url
    }
    catch(e) {
      unsafeWindow.window.location = url
    }
  }
}

var process_webmonkey_post_intent_redirect_to_url = function() {
  var url = null

  if (typeof user_options.webmonkey.post_intent_redirect_to_url === 'string')
    url = user_options.webmonkey.post_intent_redirect_to_url

  if (typeof user_options.webmonkey.post_intent_redirect_to_url === 'function')
    url = user_options.webmonkey.post_intent_redirect_to_url()

  if (typeof url === 'string')
    redirect_to_url(url)
}

var process_video_url = function(video_url, video_type, vtt_url, referer_url) {
  if (!referer_url)
    referer_url = unsafeWindow.location.href

  if (typeof GM_startIntent === 'function') {
    // running in Android-WebMonkey: open Intent chooser

    var args = [
      /* action = */ 'android.intent.action.VIEW',
      /* data   = */ video_url,
      /* type   = */ video_type
    ]

    // extras:
    if (vtt_url) {
      args.push('textUrl')
      args.push(vtt_url)
    }
    if (referer_url) {
      args.push('referUrl')
      args.push(referer_url)
    }

    GM_startIntent.apply(this, args)
    process_webmonkey_post_intent_redirect_to_url()
    return true
  }
  else if (user_options.greasemonkey.redirect_to_webcast_reloaded) {
    // running in standard web browser: redirect URL to top-level tool on Webcast Reloaded website

    redirect_to_url(get_webcast_reloaded_url(video_url, vtt_url, referer_url))
    return true
  }
  else {
    return false
  }
}

// ----------------------------------------------------------------------------- helpers (xhr)

var serialize_xhr_body_object = function(data) {
  if (typeof data === 'string')
    return data

  if (!(data instanceof Object))
    return null

  var body = []
  var keys = Object.keys(data)
  var key, val
  for (var i=0; i < keys.length; i++) {
    key = keys[i]
    val = data[key]
    val = unsafeWindow.encodeURIComponent(val)

    body.push(key + '=' + val)
  }
  body = body.join('&')
  return body
}

var download_text = function(url, headers, data, callback) {
  if (data) {
    if (!headers)
      headers = {}
    if (!headers['content-type'])
      headers['content-type'] = 'application/x-www-form-urlencoded'

    switch(headers['content-type'].toLowerCase()) {
      case 'application/json':
        data = JSON.stringify(data)
        break

      case 'application/x-www-form-urlencoded':
      default:
        data = serialize_xhr_body_object(data)
        break
    }
  }

  var xhr    = new unsafeWindow.XMLHttpRequest()
  var method = data ? 'POST' : 'GET'

  xhr.open(method, url, true, null, null)

  if (headers && (typeof headers === 'object')) {
    var keys = Object.keys(headers)
    var key, val
    for (var i=0; i < keys.length; i++) {
      key = keys[i]
      val = headers[key]
      xhr.setRequestHeader(key, val)
    }
  }

  xhr.onload = function(e) {
    if (xhr.readyState === 4) {
      if (xhr.status === 200) {
        callback(xhr.responseText)
      }
    }
  }

  if (data)
    xhr.send(data)
  else
    xhr.send()
}

var download_json = function(url, headers, data, callback) {
  if (!headers)
    headers = {}
  if (!headers.accept)
    headers.accept = 'application/json'

  download_text(url, headers, data, function(text){
    try {
      callback(JSON.parse(text))
    }
    catch(e) {}
  })
}

// ----------------------------------------------------------------------------- process window

var process_window = function() {
  var $brightcove_script = unsafeWindow.document.querySelector('script[src*="players.brightcove.net"]')
  if (!$brightcove_script) return
  var $brightcove_script_src = $brightcove_script.src

  var $inline_scripts = unsafeWindow.document.querySelectorAll('script:not([src])')
  var $inline_script_text, needle, needle_index
  for (var i=0; i < $inline_scripts.length; i++) {
    $inline_script_text = $inline_scripts[i].textContent.trim()

    if ($inline_script_text.indexOf('window.__data=') === 0) {
      // contains: \"referenceId\":\"

      state.reference_id = find_needle({
        haystack: $inline_script_text,
        needle:   '\\"referenceId\\":\\"',
        tail:     '\\"'
      })
    }

    if ($inline_script_text.indexOf('window.__config=') === 0) {
      // contains: \"accountId\":\"

      state.account_id = find_needle({
        haystack: $inline_script_text,
        needle:   '\\"accountId\\":\\"',
        tail:     '\\"'
      })
    }
  }

  if (!state.reference_id || !state.account_id) return

  download_text($brightcove_script_src, null, null, function($brightcove_script_text) {
    // contains: ,policyKey:"

    state.policy_key = find_needle({
      haystack: $brightcove_script_text,
      needle:   ',policyKey:"',
      tail:     '"'
    })

    if (!state.policy_key) return

    download_json(
      /* url= */ 'https://edge.api.brightcove.com/playback/v1/accounts/' + state.account_id + '/videos/ref:' + state.reference_id,
      /* headers= */ {
        "BCOV-POLICY": state.policy_key
      },
      /* data= */ null,
      function($brightcove_data) {
        if (!$brightcove_data || (typeof $brightcove_data !== 'object') || !Array.isArray($brightcove_data.sources) || !$brightcove_data.sources.length) return

        $brightcove_data.sources = $brightcove_data.sources.filter(function(vidsrc) {
          return vidsrc && (typeof vidsrc === 'object') && vidsrc.src && vidsrc.type
        })
        if (!$brightcove_data.sources.length) return

        var video_url, video_type, vtt_url

        video_url  = $brightcove_data.sources[0].src
        video_type = $brightcove_data.sources[0].type

        if (Array.isArray($brightcove_data.text_tracks) && $brightcove_data.text_tracks.length) {
          $brightcove_data.text_tracks = $brightcove_data.text_tracks.filter(function(txtrack) {
            return txtrack && (typeof txtrack === 'object') && txtrack.src && (txtrack.kind === 'captions') && (txtrack.mime_type === 'text/webvtt')
          })

          if ($brightcove_data.text_tracks.length) {
            vtt_url = $brightcove_data.text_tracks[0].src
          }
        }

        process_video_url(video_url, video_type, vtt_url)
      }
    )
  })
}

var find_needle = function(data) {
  var index_start, index_stop

  index_start = data.haystack.indexOf(data.needle)
  if (index_start >= 0) {
    index_start += data.needle.length
    index_stop = data.haystack.indexOf(data.tail, index_start)
    if (index_stop >= index_start) {
      return data.haystack.substring(index_start, index_stop)
    }
  }
  return null
}

// ----------------------------------------------------------------------------- bootstrap

process_window()
