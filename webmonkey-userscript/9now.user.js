// ==UserScript==
// @name         9now
// @description  Improve site usability. Watch videos in external player.
// @version      3.1.0
// @include      /^https?:\/\/(?:[^\.\/]*\.)*9now\.com\.au\/.+\/episode-\d+(?:[#\?].*)?$/
// @match        *://*.9now.com.au/live/*
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
  "common": {
    "init_delay_ms":                2500
  },
  "webmonkey": {
    "post_intent_redirect_to_url":  null  // "about:blank"
  },
  "greasemonkey": {
    "redirect_to_webcast_reloaded": true,
    "force_http":                   true,
    "force_https":                  false
  }
}

// ----------------------------------------------------------------------------- constants

var constants = {
  "button_attributes": {
    "video_url":                    "x-video-url",
    "video_type":                   "x-video-type",
    "caption_url":                  "x-caption-url",
    "referer_url":                  "x-referer-url",
    "drm_scheme":                   "x-drm-scheme",
    "drm_server":                   "x-drm-server"
  },
  "img_urls": {
    "base_webcast_reloaded_icons":  "https://github.com/warren-bank/crx-webcast-reloaded/raw/gh-pages/chrome_extension/2-release/popup/img/"
  }
}

var strings = {
  "button_start_video":             "Start Video",
  "episode_labels": {
    "title":                        "title:",
    "summary":                      "summary:",
    "duration":                     "duration:",
    "video": {
      "format":                     "format:",
      "drm":                        "drm:"
    }
  },
  "livetv_epg_toggle_button": {
    "show":                         "Show",
    "hide":                         "Hide"
  },
  "livetv_channel_labels": {
    "epg": {
      "title":                      "Title:",
      "summary":                    "Summary:",
      "duration_date_range":        "Time:",
      "duration":                   "Duration:"
    }
  }
}

// ----------------------------------------------------------------------------- state

var state = {
  policy_key:   null,
  account_id:   null,

  series:        {}, // {title, summary}
  episode:       {}, // {reference_id, title, summary, duration}
  video_sources: [],

  current_livetv_channel: {}, // {id, name, epg: [{title, duration_date_range, duration, summary}], video_data}
  other_livetv_channels: [], // [{id, name, epg: [{title, duration_date_range, duration}]}]
}

// ----------------------------------------------------------------------------- CSP

// add support for CSP 'Trusted Type' assignment
var add_default_trusted_type_policy = function() {
  if (typeof unsafeWindow.trustedTypes !== 'undefined') {
    try {
      var passthrough_policy = function(string) {return string}

      unsafeWindow.trustedTypes.createPolicy('default', {
          createHTML:      passthrough_policy,
          createScript:    passthrough_policy,
          createScriptURL: passthrough_policy
      })
    }
    catch(e) {}
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

// ----------------------------------------------------------------------------- helpers

var make_element = function(elementName, html, text) {
  var el = unsafeWindow.document.createElement(elementName)

  if (html)
    el.innerHTML = html

  if (text)
    el.textContent = text

  return el
}

var make_span = function(text) {return make_element('span', null, text)}
var make_h4   = function(text) {return make_element('h4',   null, text)}

var add_style_element = function(css) {
  if (!css) return

  var head = unsafeWindow.document.getElementsByTagName('head')[0]
  if (!head) return

  if ('function' === (typeof css))
    css = css()
  if (Array.isArray(css))
    css = css.join("\n")

  head.appendChild(
    make_element('style', null, css)
  )
}

var empty_element = function(el, html, text) {
  while (el.childNodes.length)
    el.removeChild(el.childNodes[0])

  if (html)
    el.innerHTML = html

  if (text)
    el.textContent = text

  return el
}

var append_tr = function(tr, td, colspan) {
  if (Array.isArray(td))
    tr.push('<tr><td>' + td.join('</td><td>') + '</td></tr>')
  else if ((typeof colspan === 'number') && (colspan > 1))
    tr.push('<tr><td colspan="' + colspan + '">' + td + '</td></tr>')
  else
    tr.push('<tr><td>' + td + '</td></tr>')
}

var cancel_event = function(event) {
  event.stopPropagation();event.stopImmediatePropagation();event.preventDefault();event.returnValue=false;
}

// https://stackoverflow.com/a/66696162
var convertSecondsToReadableString = function(seconds) {
  seconds = seconds || 0
  seconds = Number(seconds)
  seconds = Math.abs(seconds)

  var d = Math.floor(seconds / (3600 * 24))
  var h = Math.floor(seconds % (3600 * 24) / 3600)
  var m = Math.floor(seconds % 3600 / 60)
  var s = Math.floor(seconds % 60)
  var parts = []

  if (d > 0) {
    parts.push(d + ' day' + (d > 1 ? 's' : ''))
  }
  if (h > 0) {
    parts.push(h + ' hour' + (h > 1 ? 's' : ''))
  }
  if (m > 0) {
    parts.push(m + ' minute' + (m > 1 ? 's' : ''))
  }
  if (s > 0) {
    parts.push(s + ' second' + (s > 1 ? 's' : ''))
  }
  return parts.join(', ')
}

var convertDateRangeToDurationSeconds = function(start_date, end_date) {
  start_date = new Date(start_date)
  end_date   = new Date(end_date)

  var durationMs = start_date.getTime() - end_date.getTime()

  return Math.floor(durationMs / 1000)
}

var convertDateRangeToReadableString = function(start_date, end_date) {
  start_date = new Date(start_date)
  end_date   = new Date(end_date)

  var parts = {
    start_date: start_date.toLocaleDateString(),
    start_time: start_date.toLocaleTimeString(),

    end_date:   end_date.toLocaleDateString(),
    end_time:   end_date.toLocaleTimeString()
  }

  var range = parts.start_date + ' ' + parts.start_time + ' - ' + ((parts.end_date !== parts.start_date) ? (parts.end_date + ' ') : '') + parts.end_time
  return range
}

var find_needle = function(data) {
  var index_start, index_stop

  index_start = data.haystack.indexOf(data.needle)
  if (index_start >= 0) {
    index_start += data.needle.length
    index_stop = data.haystack.indexOf(data.tail, index_start)
    if ((index_stop === -1) && !data.strict) {
      index_stop = data.haystack.length
    }
    if (index_stop >= index_start) {
      return data.haystack.substring(index_start, index_stop)
    }
  }
  return null
}

// ----------------------------------------------------------------------------- URL links to tools on Webcast Reloaded website

var get_webcast_reloaded_url = function(video_data, force_http, force_https) {
  force_http  = (typeof force_http  === 'boolean') ? force_http  : user_options.greasemonkey.force_http
  force_https = (typeof force_https === 'boolean') ? force_https : user_options.greasemonkey.force_https

  var encoded_video_url, encoded_caption_url, encoded_referer_url, encoded_drm_url, webcast_reloaded_base, webcast_reloaded_url

  encoded_video_url      = encodeURIComponent(encodeURIComponent(btoa(video_data.video_url)))
  encoded_caption_url    = video_data.caption_url ? encodeURIComponent(encodeURIComponent(btoa(video_data.caption_url))) : null
  video_data.referer_url = video_data.referer_url ? video_data.referer_url : unsafeWindow.location.href
  encoded_referer_url    = encodeURIComponent(encodeURIComponent(btoa(video_data.referer_url)))
  encoded_drm_url        = (video_data.drm.scheme && video_data.drm.server) ? encodeURIComponent(encodeURIComponent(btoa(video_data.drm.scheme + '|' + video_data.drm.server))) : null

  webcast_reloaded_base = {
    "https": "https://warren-bank.github.io/crx-webcast-reloaded/external_website/index.html",
    "http":  "http://webcast-reloaded.frii.site/index.html"
  }

  webcast_reloaded_base = (force_http)
                            ? webcast_reloaded_base.http
                            : (force_https)
                               ? webcast_reloaded_base.https
                               : (video_data.video_url.toLowerCase().indexOf('http:') === 0)
                                  ? webcast_reloaded_base.http
                                  : webcast_reloaded_base.https

  webcast_reloaded_url  = webcast_reloaded_base    + '#/watch/'    + encoded_video_url
                            + (encoded_caption_url ? ('/subtitle/' + encoded_caption_url) : '')
                            + (encoded_referer_url ? ('/referer/'  + encoded_referer_url) : '')
                            + (encoded_drm_url     ? ('/drm/'      + encoded_drm_url) : '')

  return webcast_reloaded_url
}

var get_webcast_reloaded_url_chromecast_sender = function(video_data) {
  return get_webcast_reloaded_url(video_data, /* force_http= */ null, /* force_https= */ null).replace('/index.html', '/chromecast_sender.html')
}

var get_webcast_reloaded_url_airplay_sender = function(video_data) {
  return get_webcast_reloaded_url(video_data, /* force_http= */ true, /* force_https= */ false).replace('/index.html', '/airplay_sender.es5.html')
}

var get_webcast_reloaded_url_proxy = function(video_data) {
  return get_webcast_reloaded_url(video_data, /* force_http= */ true, /* force_https= */ false).replace('/index.html', '/proxy.html')
}

var get_webcast_reloaded_urls = function(video_data) {
  return {
    "index":             get_webcast_reloaded_url(                  video_data),
    "chromecast_sender": get_webcast_reloaded_url_chromecast_sender(video_data),
    "airplay_sender":    get_webcast_reloaded_url_airplay_sender(   video_data),
    "proxy":             get_webcast_reloaded_url_proxy(            video_data)
  }
}

// ----------------------------------------------------------------------------- URL handlers

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

// -----------------------------------------------------------------------------

var process_video_data = function(data) {
  if (!data.video_url) return

  if (!data.referer_url)
    data.referer_url = unsafeWindow.location.href

  if (typeof GM_startIntent === 'function') {
    // running in Android-WebMonkey: open Intent chooser

    if (!data.video_type)
      data.video_type = determine_video_type(data.video_url)

    var args = [
      /* action = */ 'android.intent.action.VIEW',
      /* data   = */ data.video_url,
      /* type   = */ data.video_type
    ]

    // extras:
    if (data.caption_url) {
      args.push('textUrl')
      args.push(data.caption_url)
    }
    if (data.referer_url) {
      args.push('referUrl')
      args.push(data.referer_url)
    }
    if (data.drm.scheme) {
      args.push('drmScheme')
      args.push(data.drm.scheme)
    }
    if (data.drm.server) {
      args.push('drmUrl')
      args.push(data.drm.server)
    }
    if (data.drm.headers && (typeof data.drm.headers === 'object')) {
      var drm_header_keys, drm_header_key, drm_header_val

      drm_header_keys = Object.keys(data.drm.headers)
      for (var i=0; i < drm_header_keys.length; i++) {
        drm_header_key = drm_header_keys[i]
        drm_header_val = data.drm.headers[drm_header_key]

        args.push('drmHeader')
        args.push(drm_header_key + ': ' + drm_header_val)
      }
    }

    GM_startIntent.apply(this, args)
    process_webmonkey_post_intent_redirect_to_url()
    return true
  }
  else if (user_options.greasemonkey.redirect_to_webcast_reloaded) {
    // running in standard web browser: redirect URL to top-level tool on Webcast Reloaded website

    redirect_to_url(
      get_webcast_reloaded_url(data)
    )
    return true
  }
  else {
    return false
  }
}

var process_hls_data = function(data) {
  data.video_type = 'application/x-mpegurl'
  process_video_data(data)
}

var process_dash_data = function(data) {
  data.video_type = 'application/dash+xml'
  process_video_data(data)
}

// -----------------------------------------------------------------------------

var process_video_url = function(video_url, video_type, caption_url, referer_url, drm_scheme, drm_server) {
  var data = {
    video_url:   video_url   || null,
    video_type:  video_type  || null,
    caption_url: caption_url || null,
    referer_url: referer_url || null,
    drm: {
      scheme:    drm_scheme,
      server:    drm_server,
      headers:   null
    }
  }

  process_video_data(data)
}

var process_hls_url = function(hls_url, caption_url, referer_url, drm_scheme, drm_server) {
  process_video_url(/* video_url= */ hls_url, /* video_type= */ 'application/x-mpegurl', caption_url, referer_url, drm_scheme, drm_server)
}

var process_dash_url = function(dash_url, caption_url, referer_url, drm_scheme, drm_server) {
  process_video_url(/* video_url= */ dash_url, /* video_type= */ 'application/dash+xml', caption_url, referer_url, drm_scheme, drm_server)
}

// ----------------------------------------------------------------------------- API: download live tv guide

var download_livetv_guide = function(channelId, callback) {
  download_json(
    /* url= */ 'https://api.9now.com.au/web/live-experience?device=web&slug=' + channelId + '&streamParams=web%2Cfirefox%2Cwindows&region=nsw&offset=0',
    /* headers= */ null,
    /* data= */ null,
    function(livetv_data) {
      if (
        !livetv_data || (typeof livetv_data !== 'object') ||
        !livetv_data.data || (typeof livetv_data.data !== 'object') ||
        !livetv_data.data.getLXP || (typeof livetv_data.data.getLXP !== 'object') ||
        !livetv_data.data.getLXP.stream || (typeof livetv_data.data.getLXP.stream !== 'object') ||
        !livetv_data.data.getLXP.stream.video || (typeof livetv_data.data.getLXP.stream.video !== 'object') ||
        !(livetv_data.data.getLXP.stream.video.url || livetv_data.data.getLXP.stream.video.referenceId) ||
        !livetv_data.data.getLXP.stream.display || (typeof livetv_data.data.getLXP.stream.display !== 'object') ||
        !livetv_data.data.getLXP.stream.display.tagline
      ) return

      state.series = {
        title:   'Live TV Channels',
        summary: null
      }

      var video_data = !!livetv_data.data.getLXP.stream.video.url
        ? {
            video_url:   livetv_data.data.getLXP.stream.video.url,
            video_type:  ((livetv_data.data.getLXP.stream.video.streamType === 'hls') ? 'application/x-mpegurl' : 'application/dash+xml'),
            caption_url: null,
            referer_url: null,
            drm: {
              scheme:    null,
              server:    null,
              headers:   null
            }
          }
        : null

      state.current_livetv_channel = {
        id:         channelId,
        name:       livetv_data.data.getLXP.stream.display.tagline,
        epg:        normalize_epg_data(livetv_data.data.getLXP.stream.display.listings), // parameter: [{title, description, startDate, endDate}]
        video_data: video_data
      }

      if (Array.isArray(livetv_data.data.getLXP.switcherRail) && livetv_data.data.getLXP.switcherRail.length) {
        state.other_livetv_channels = livetv_data.data.getLXP.switcherRail
          .map(function(channel) {
            if (!channel || (typeof channel !== 'object') || !channel.slug || !channel.name) return null

            var epg = []
            switch(channel.type) {
              case 'channel':
                epg = normalize_epg_data(channel.airings) // parameter: [{title, startDate, endDate}]
                break
              case 'live-event-group':
                if (channel.currentProgramName && channel.programStartDate && channel.programEndDate) {
                  epg = normalize_epg_data([{
                    title:     channel.currentProgramName,
                    startDate: channel.programStartDate,
                    endDate:   channel.programEndDate
                  }])
                }
                break
            }

            return {
              id:   channel.slug,
              name: channel.name,
              epg:  epg
            }
          })
          .filter(function(channel) {
            return !!channel && (channel.id !== state.current_livetv_channel.id)
          })
      }

      if (video_data)
        callback()
      else
        download_current_livetv_channel_video_sources(livetv_data.data.getLXP.stream.video.referenceId, callback)
    }
  )
}

var normalize_epg_data = function(epg_data) {
  if (!Array.isArray(epg_data) || !epg_data.length) return null

  return epg_data
    .map(function(obj) {
      if (!obj || (typeof obj !== 'object') || !obj.title || !obj.startDate || !obj.endDate) return null

      var duration_date_range = convertDateRangeToReadableString(obj.startDate, obj.endDate)
      var duration = convertSecondsToReadableString(
        convertDateRangeToDurationSeconds(obj.startDate, obj.endDate)
      )

      return {
        title:               obj.title,
        summary:             obj.description,
        duration_date_range: duration_date_range,
        duration:            duration
      }
    })
    .filter(function(obj) {
      return !!obj
    })
}

// ----------------------------------------------------------------------------- API: download video sources

var download_video_sources = function(reference_id, callback) {
  obtain_brightcove_api_parameters(function() {
    download_json(
      /* url= */ 'https://edge.api.brightcove.com/playback/v1/accounts/' + state.account_id + '/videos/ref:' + reference_id,
      /* headers= */ {
        "BCOV-POLICY": state.policy_key
      },
      /* data= */ null,
      function(api_media_data) {
        normalize_api_media_data(api_media_data, function(video_sources) {
          callback(video_sources, api_media_data)
        })
      }
    )
  })
}

var obtain_brightcove_api_parameters = function(callback) {
  if (state.account_id && state.policy_key) {
    callback()
    return
  }

  var $brightcove_script_src = null
  var $brightcove_script, appConfig

  if (!$brightcove_script_src) {
    $brightcove_script = unsafeWindow.document.querySelector('script[src*="players.brightcove.net"]')
    if ($brightcove_script) {
      $brightcove_script_src = $brightcove_script.src
    }
  }

  if (!$brightcove_script_src) {
    try {
      appConfig = unsafeWindow.document.querySelector('script#appConfig[type="application/json"]')
      if (appConfig) {
        appConfig = JSON.parse(appConfig.textContent)
        $brightcove_script_src = 'https://players.brightcove.net/' + appConfig.webDedicatedPlayer.accountId + '/' + appConfig.webDedicatedPlayer.playerId + '_default/index.min.js'
      }
    }
    catch(e) {}
  }

  if (!$brightcove_script_src) return

  download_text($brightcove_script_src, null, null, function($brightcove_script_text) {
    // contains: {accountId:"
    // contains: ,policyKey:"

    state.account_id = find_needle({
      haystack: $brightcove_script_text,
      needle:   '{name:"catalog",autoInit:true,options:{accountId:"',
      tail:     '"',
      strict:   true
    })

    state.policy_key = find_needle({
      haystack: $brightcove_script_text,
      needle:   ',policyKey:"',
      tail:     '"',
      strict:   true
    })

    if (state.account_id && state.policy_key) {
      callback()
    }
  })
}

var normalize_api_media_data = function(api_media_data, callback) {
  if (!api_media_data || (typeof api_media_data !== 'object') || !Array.isArray(api_media_data.sources) || !api_media_data.sources.length) return

  api_media_data.sources = api_media_data.sources.filter(function(vidsrc) {
    return !!(vidsrc && (typeof vidsrc === 'object') && vidsrc.src && vidsrc.type)
  })
  if (!api_media_data.sources.length) return

  var caption_url

  if (Array.isArray(api_media_data.text_tracks) && api_media_data.text_tracks.length) {
    api_media_data.text_tracks = api_media_data.text_tracks.filter(function(txtrack) {
      return !!(txtrack && (typeof txtrack === 'object') && txtrack.src && (txtrack.kind === 'captions') && (txtrack.mime_type === 'text/webvtt'))
    })

    if (api_media_data.text_tracks.length) {
      caption_url = api_media_data.text_tracks[0].src
    }
  }

  var video_sources = []
  var drm_schemes = ['widevine', 'clearkey', 'playready', 'fairplay']
  var src, video_data, has_drm, drm_keys, drm_key, drm_data, drm_scheme

  for (var i=0; i < api_media_data.sources.length; i++) {
    src = api_media_data.sources[i]

    video_data = {
      video_url:   src.src,
      video_type:  src.type,
      caption_url: caption_url,
      referer_url: null,
      drm: {
        scheme:    null,
        server:    null,
        headers:   null
      }
    }

    has_drm = false

    if (src.key_systems && (typeof src.key_systems === 'object')) {
      drm_keys = Object.keys(src.key_systems)

      if (drm_keys.length)
        has_drm = true

      for (var j=0; j < drm_keys.length; j++) {
        drm_key  = drm_keys[j]
        drm_data = src.key_systems[drm_key]

        if (drm_data && (typeof drm_data === 'object') && drm_data.license_url) {
          drm_scheme = resolve_drm_scheme(drm_schemes, drm_key)

          if (drm_scheme) {
            video_sources.push(
              Object.assign({}, video_data, {drm: {
                scheme:  drm_scheme,
                server:  drm_data.license_url,
                headers: null
              }})
            )
          }
        }
      }
    }

    if (!has_drm) {
      video_sources.push(video_data)
    }
  }

  callback(video_sources)
}

var resolve_drm_scheme = function(drm_schemes, drm_key) {
  var drm_scheme

  for (var i=0; i < drm_schemes.length; i++) {
    drm_scheme = drm_schemes[i]

    if (drm_key.indexOf(drm_scheme) >= 0) {
      return drm_scheme
    }
  }

  return null
}

// ----------------------------------------------------------------------------- API: download video sources for episode in series

var download_episode_video_sources = function(callback) {
  download_video_sources(state.episode.reference_id, function(video_sources, api_media_data) {
    state.episode.title    = api_media_data.name || unsafeWindow.document.title || ''
    state.episode.summary  = api_media_data.long_description || api_media_data.description || ''
    state.episode.duration = api_media_data.duration ? convertSecondsToReadableString(Math.floor(api_media_data.duration / 1000)) : ''

    callback(video_sources)
  })
}

// ----------------------------------------------------------------------------- API: download video sources for current live tv channel

var download_current_livetv_channel_video_sources = function(reference_id, callback) {
  download_video_sources(reference_id, function(video_sources, api_media_data) {
    if (Array.isArray(video_sources) && video_sources.length) {
      state.current_livetv_channel.video_data = video_sources[0]
      callback()
    }
  })
}

// ----------------------------------------------------------------------------- DOM: static skeleton

var reinitialize_dom = function() {
  add_default_trusted_type_policy()

  var is_livetv_channel, is_episode, keep_elements

  is_livetv_channel = state.current_livetv_channel.id && state.current_livetv_channel.name && state.current_livetv_channel.video_data && state.current_livetv_channel.video_data.video_url && state.current_livetv_channel.video_data.video_type
  is_episode        = !is_livetv_channel && Array.isArray(state.video_sources) && state.video_sources.length
  keep_elements     = {}

  if (is_episode) {
    keep_elements.other_episodes = Array.prototype.slice.apply(unsafeWindow.document.querySelectorAll('ul > li > a[href][itemtype="https://schema.org/TVEpisode"]')).map(function($a) {
      var episode = {
        url: $a.href,
        label: ''
      }

      var label = $a.querySelector(':scope h3[itemprop="name"]')
      if (label)
        episode.label = label.textContent

      return episode
    })
  }

  unsafeWindow.document.close()
  unsafeWindow.document.open()
  unsafeWindow.document.write('')
  unsafeWindow.document.close()

  empty_element(unsafeWindow.document.getElementsByTagName('head')[0])
  empty_element(unsafeWindow.document.body)

  add_style_element(function(){
    return [
      // --------------------------------------------------- reset

      'body {',
      '  margin: 0;',
      '  padding: 0;',
      '  font-family: serif;',
      '  font-size: 16px;',
      '  background-color: #fff !important;',
      '  overflow: auto !important;',
      '}',

      // --------------------------------------------------- series title

      'body > div > h2 {',
      '  display: block;',
      '  margin: 0;',
      '  padding: 0.5em;',
      '  font-size: 22px;',
      '  text-align: center;',
      '  background-color: #ccc;',
      '}',

      // --------------------------------------------------- series description

      'body > div > div {',
      '  padding: 0.5em;',
      '  font-size: 18px;',
      '}',

      // --------------------------------------------------- list of videos: episodes in series, or individual movie or episode

      'body > div > ul {',
      '  list-style: none;',
      '  margin: 0;',
      '  padding: 0;',
      '  padding-left: 1em;',
      '  padding-bottom: 1em;',
      '}',

      'body > div > ul > li {',
      '  list-style: none;',
      '  margin-top: 0.5em;',
      '  border-top: 1px solid #999;',
      '  padding-top: 0.5em;',
      '}',

      'body > div > ul > li:first-child {',
      '  border-top-style: none;',
      '}',

      'body > div > ul > li > table td:first-child {',
      '  font-style: italic;',
      '  padding-right: 1em;',
      '}',

      'body > div > ul > li > blockquote {',
      '  display: block;',
      '  background-color: #eee;',
      '  padding: 0.5em 1em;',
      '  margin: 0;',
      '}',

      'body > div > ul > li > div {',
      '  margin: 0.75em 0;',
      '}',

      // --------------------------------------------------- drm

      'body > div > ul > li > div > table {',
      '  width: 100%;',
      '  border-collapse: collapse;',
      '}',

      'body > div > ul > li > div > table tr > td:first-child + td {',
      '  width: 100%;',
      '}',

      'body > div > ul > li > div > table tr > td {',
      '  border-top: 1px solid #999;',
      '  padding: 0.5em 0;',
      '}',

      'body > div > ul > li > div > table tr:first-child > td {',
      '  border-top-style: none;',
      '}',

      'body > div > ul > li > div > table button {',
      '  white-space: nowrap;',
      '}',

      'body > div > ul > li > div > table tr > td:last-child > div.icons-container {',
      '}',

      // --------------------------------------------------- links to tools on Webcast Reloaded website

      'body > div > ul > li div.icons-container {',
      '  display: block;',
      '  position: relative;',
      '  z-index: 1;',
      '  float: right;',
      '  margin: 0.5em;',
      '  width: 60px;',
      '  height: 60px;',
      '  max-height: 60px;',
      '  vertical-align: top;',
      '  background-color: #d7ecf5;',
      '  border: 1px solid #000;',
      '  border-radius: 14px;',
      '}',

      'body > div > ul > li div.icons-container > a.chromecast,',
      'body > div > ul > li div.icons-container > a.chromecast > img,',
      'body > div > ul > li div.icons-container > a.airplay,',
      'body > div > ul > li div.icons-container > a.airplay > img,',
      'body > div > ul > li div.icons-container > a.proxy,',
      'body > div > ul > li div.icons-container > a.proxy > img,',
      'body > div > ul > li div.icons-container > a.video-link,',
      'body > div > ul > li div.icons-container > a.video-link > img {',
      '  display: block;',
      '  width: 25px;',
      '  height: 25px;',
      '}',

      'body > div > ul > li div.icons-container > a.chromecast,',
      'body > div > ul > li div.icons-container > a.airplay,',
      'body > div > ul > li div.icons-container > a.proxy,',
      'body > div > ul > li div.icons-container > a.video-link {',
      '  position: absolute;',
      '  z-index: 1;',
      '  text-decoration: none;',
      '}',

      'body > div > ul > li div.icons-container > a.chromecast,',
      'body > div > ul > li div.icons-container > a.airplay {',
      '  top: 0;',
      '}',
      'body > div > ul > li div.icons-container > a.proxy,',
      'body > div > ul > li div.icons-container > a.video-link {',
      '  bottom: 0;',
      '}',

      'body > div > ul > li div.icons-container > a.chromecast,',
      'body > div > ul > li div.icons-container > a.proxy {',
      '  left: 0;',
      '}',
      'body > div > ul > li div.icons-container > a.airplay,',
      'body > div > ul > li div.icons-container > a.video-link {',
      '  right: 0;',
      '}',
      'body > div > ul > li div.icons-container > a.airplay + a.video-link {',
      '  right: 17px; /* (60 - 25)/2 to center when there is no proxy icon */',
      '}',

      // --------------------------------------------------- live tv channel

      'body > div > ul > li > blockquote + div + div > table.livetv-channel tr {',
      '  vertical-align: top;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel tr > td {',
      '  padding: 0;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel tr > td:first-child {',
      '  white-space: nowrap;',
      '  padding-right: 1em;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel tr > td > h3 {',
      '  padding: 0;',
      '  margin: 0;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel table {',
      '  width: 100%;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel table table tr > td {',
      '  border-style: none;',
      '  padding: 0.25em 0;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel div.livetv-epg-toggle-container {',
      '  transition: height  0.5s linear;',
      '  overflow-y: hidden !important;',
      '  height: auto !important;',
      '}',

      'body > div > ul > li > blockquote + div + div > table.livetv-channel div.livetv-epg-toggle-container.toggle-hide {',
      '  height: 0px !important;',
      '}',

      ''
    ]
  })

  var div, ul, li, div_dynamic
  var i

  div = make_element('div')
  ul  = make_element('ul')
  div.appendChild(ul)

  if (state.series.title) {
    div.insertBefore(
      make_element('h2', null, state.series.title),
      ul
    )
  }

  if (state.series.summary) {
    div.insertBefore(
      make_element('div', null, state.series.summary),
      ul
    )
  }

  if (is_episode) {
    li = make_episode_listitem_element(
      state.episode
    )

    if (li) {
      div_dynamic = li.querySelector(':scope > blockquote + div')
      add_video_sources_to_listitem_element(div_dynamic, state.video_sources)

      ul.appendChild(li)
    }
  }

  if (is_livetv_channel) {
    li = make_livetv_channel_listitem_element(
      state.current_livetv_channel
    )

    if (li) {
      div_dynamic = li.querySelector(':scope > blockquote + div')
      add_video_sources_to_listitem_element(div_dynamic, [state.current_livetv_channel.video_data])

      ul.appendChild(li)
    }

    for (i=0; i < state.other_livetv_channels.length; i++) {
      li = make_livetv_channel_listitem_element(
        state.other_livetv_channels[i]
      )

      if (li)
        ul.appendChild(li)
    }
  }

  unsafeWindow.document.body.appendChild(div)

  if (is_episode) {
    display_other_episodes(keep_elements.other_episodes)
  }
}

// ----------------------------------------------------------------------------- DOM: <li> for episode in show series

var make_episode_listitem_element = function(episode) {
  // const {reference_id, title, summary, duration} = episode

  var tr, html, li

  tr = []
  if (episode.title)
    append_tr(tr, [strings.episode_labels.title, episode.title])
  if (episode.duration)
    append_tr(tr, [strings.episode_labels.duration, episode.duration])
  if (episode.expires)
    append_tr(tr, [strings.episode_labels.expires, episode.expires])
  if (episode.summary)
    append_tr(tr, strings.episode_labels.summary, 2)

  html = [
    '<table>' + tr.join("\n") + '</table>',
    '<blockquote>' + episode.summary + '</blockquote>',
    '<div></div>'
  ]

  li = make_element('li', html.join("\n"))

  return li
}

var add_video_sources_to_listitem_element = function(div_dynamic, video_sources) {
  // video_sources is array of video_data: {video_url, video_type, caption_url, referer_url, drm: {scheme, server, headers}}

  var tr, video_data, video_summary, td_button, td_icons, div_icons, a_icons, a_icon
  var i

  tr = []
  for (i=0; i < video_sources.length; i++) {
    video_data = video_sources[i]

    video_summary  = '<ul>'
    video_summary += '  <li>' + strings.episode_labels.video.format + ' ' + video_data.video_type + '</li>'
    video_summary += '  <li>' + strings.episode_labels.video.drm    + ' ' + (video_data.drm.scheme || 'none') + '</li>'
    video_summary += '</ul>'

    append_tr(tr, ['', video_summary, '']) // col 1: button. col 3: icons.
  }
  empty_element(div_dynamic, '<table>' + tr.join("\n") + '</table>')

  tr = div_dynamic.querySelectorAll(':scope > table tr')

  for (i=0; i < tr.length; i++) {
    video_data = video_sources[i]

    td_button = tr[i].querySelector(':scope > td:first-child')
    td_icons  = tr[i].querySelector(':scope > td:last-child')

    add_start_video_button(/* block_element= */ td_button, video_data)

    if (video_data.drm.scheme) {
      div_icons = make_webcast_reloaded_div(video_data)

      a_icons = {
        real:    {},  // order: chromecast, airplay, [proxy], video-link
        ordered: []
      }

      a_icons.real.airplay    = div_icons.querySelector('a.airplay')
      a_icons.real.direct_hls = div_icons.querySelector('a.video-link')

      a_icon = a_icons.real.direct_hls.cloneNode(/* deep= */ true)
      a_icon.className = 'chromecast'
      a_icons.ordered.push(a_icon)

      a_icon = a_icons.real.direct_hls.cloneNode(/* deep= */ true)
      a_icon.className = 'airplay'
      a_icon.setAttribute('href',  video_data.drm.server)
      a_icon.setAttribute('title', 'direct link to ' + video_data.drm.scheme + ' drm server')
      a_icons.ordered.push(a_icon)

      a_icon = a_icons.real.airplay.cloneNode(/* deep= */ true)
      a_icon.className = 'video-link'
      a_icons.ordered.push(a_icon)

      empty_element(div_icons)

      for (var j=0; j < a_icons.ordered.length; j++) {
        a_icon = a_icons.ordered[j]

        div_icons.appendChild(a_icon)
      }
      a_icons = null

      td_icons.appendChild(div_icons)
    }
    else {
      insert_webcast_reloaded_div(/* block_element= */ td_icons, video_data)
    }
  }
}

var add_start_video_button = function(block_element, video_data) {
  var new_button = make_start_video_button(video_data)

  block_element.appendChild(new_button)
}

var make_start_video_button = function(video_data) {
  var button = make_element('button')

  button.setAttribute(constants.button_attributes.video_url,   video_data.video_url   || '')
  button.setAttribute(constants.button_attributes.video_type,  video_data.video_type  || '')
  button.setAttribute(constants.button_attributes.caption_url, video_data.caption_url || '')
  button.setAttribute(constants.button_attributes.referer_url, video_data.referer_url || '')
  button.setAttribute(constants.button_attributes.drm_scheme,  video_data.drm.scheme  || '')
  button.setAttribute(constants.button_attributes.drm_server,  video_data.drm.server  || '')
  button.textContent = strings.button_start_video
  button.addEventListener("click", onclick_start_video_button)

  return button
}

var onclick_start_video_button = function(event) {
  cancel_event(event)

  var button      = event.target
  var video_url   = button.getAttribute(constants.button_attributes.video_url)
  var video_type  = button.getAttribute(constants.button_attributes.video_type)
  var caption_url = button.getAttribute(constants.button_attributes.caption_url)
  var referer_url = button.getAttribute(constants.button_attributes.referer_url)
  var drm_scheme  = button.getAttribute(constants.button_attributes.drm_scheme)
  var drm_server  = button.getAttribute(constants.button_attributes.drm_server)

  if (video_url)
    process_video_url(video_url, video_type, caption_url, referer_url, drm_scheme, drm_server)
}

// -----------------------------------------------------------------------------

var insert_webcast_reloaded_div = function(block_element, video_data) {
  var webcast_reloaded_div = make_webcast_reloaded_div(video_data)

  block_element.appendChild(webcast_reloaded_div)
}

var make_webcast_reloaded_div = function(video_data) {
  var webcast_reloaded_urls = get_webcast_reloaded_urls(video_data)

  var div = make_element('div')

  var html = [
    '<a target="_blank" class="chromecast" href="' + webcast_reloaded_urls.chromecast_sender   + '" title="Chromecast Sender"><img src="'       + constants.img_urls.base_webcast_reloaded_icons + 'chromecast.png"></a>',
    '<a target="_blank" class="airplay" href="'    + webcast_reloaded_urls.airplay_sender      + '" title="ExoAirPlayer Sender"><img src="'     + constants.img_urls.base_webcast_reloaded_icons + 'airplay.png"></a>',
    '<a target="_blank" class="proxy" href="'      + webcast_reloaded_urls.proxy               + '" title="HLS-Proxy Configuration"><img src="' + constants.img_urls.base_webcast_reloaded_icons + 'proxy.png"></a>',
    '<a target="_blank" class="video-link" href="' + video_data.video_url                      + '" title="direct link to video"><img src="'    + constants.img_urls.base_webcast_reloaded_icons + 'video_link.png"></a>'
  ]

  div.setAttribute('class', 'icons-container')
  div.innerHTML = html.join("\n")

  return div
}

// -----------------------------------------------------------------------------

var display_other_episodes = function(other_episodes) {
  if (!Array.isArray(other_episodes) || !other_episodes.length) return

  var li = other_episodes.map(function(episode) {
    return '<li><a href="' + episode.url + '">' + episode.label + '</a></li>'
  }).join("\n")

  var html = [
    '<hr />',
    '<h3>More Episodes:</h3>',
    '<ul>',
       li,
    '</ul>'
  ].join("\n")

  var div = make_element('div', html)
  div.className = 'other-episodes-container'

  unsafeWindow.document.body.appendChild(div)
}

// ----------------------------------------------------------------------------- DOM: <li> for live tv channel

var make_livetv_channel_listitem_element = function(channel) {
  // const {id, name, epg} = channel

  var tr, epg_html, html, li, livetv_epg_toggle_button

  tr = []
  if (Array.isArray(channel.epg) && channel.epg.length) {
    for (var i=0; i < channel.epg.length; i++) {
      append_tr(
        tr,
        add_epg_to_livetv_channel_listitem_element(channel.epg[i])
      )
    }
  }

  epg_html = []
  if (tr.length) {
    epg_html = [
      '<div>',
        '<table class="livetv-channel">',
          '<tr>',
            '<td></td>',
            '<td>',
              '<h3>EPG:</h3>',
              '<button class="livetv-epg-toggle-button">' + strings.livetv_epg_toggle_button.show + '</button>',
              '<div class="livetv-epg-toggle-container toggle-hide">',
                '<table class="livetv-epg">',
                  '<tr><td></td></tr>',
                  tr.join("\n"),
                '</table>',
              '</div>',
            '</td>',
          '</tr>',
        '</table>',
      '</div>'
    ]
  }

  html = [
    '<blockquote>',
      (channel.video_data ? channel.name : ('<a href="/live/' + channel.id + '">' + channel.name + '</a>')),
    '</blockquote>',
    '<div></div>',
    epg_html.join("\n")
  ]

  li = make_element('li', html.join("\n"))

  epg_html = null
  html = null

  livetv_epg_toggle_button = li.querySelector(':scope button.livetv-epg-toggle-button')
  if (livetv_epg_toggle_button) {
    livetv_epg_toggle_button.addEventListener("click", onclick_livetv_epg_toggle_button)
  }

  return li
}

var add_epg_to_livetv_channel_listitem_element = function(epg) {
  // const {title, summary, duration_date_range, duration} = epg

  var tr = []
  if (epg.duration_date_range)
    append_tr(tr, [strings.livetv_channel_labels.epg.duration_date_range, epg.duration_date_range])
  if (epg.duration)
    append_tr(tr, [strings.livetv_channel_labels.epg.duration, epg.duration])
  if (epg.title)
    append_tr(tr, [strings.livetv_channel_labels.epg.title, epg.title])
  if (epg.summary)
    append_tr(tr, [strings.livetv_channel_labels.epg.summary, epg.summary])

  return '<table>' + tr.join("\n") + '</table>'
}

var onclick_livetv_epg_toggle_button = function(event) {
  cancel_event(event)

  var className = 'toggle-hide'
  var button, div_dynamic

  button = event.target
  if (!button) return

  div_dynamic = button.nextElementSibling
  if (!div_dynamic || !div_dynamic.classList.contains('livetv-epg-toggle-container')) return

  if (div_dynamic.classList.contains(className)) {
    // toggle: hide => show
    div_dynamic.classList.remove(className)
    button.textContent = strings.livetv_epg_toggle_button.hide
  }
  else {
    // toggle: show => hide
    div_dynamic.classList.add(className)
    button.textContent = strings.livetv_epg_toggle_button.show
  }
}

// ----------------------------------------------------------------------------- bootstrap: live tv

var page_init_livetv = function() {
  var path = unsafeWindow.location.pathname
  var channelId

  if (path.indexOf('/live/') === 0) {
    channelId = find_needle({
      haystack: path,
      needle:   '/live/',
      tail:     '?',
      strict:   false
    })

    if (channelId) {
      download_livetv_guide(channelId, reinitialize_dom)
      return true
    }
  }
  return false
}

// ----------------------------------------------------------------------------- bootstrap: episode in series

var page_init_shows = function() {
  var $inline_scripts = unsafeWindow.document.querySelectorAll('script:not([src])')
  var $inline_script_text, needle, needle_index
  for (var i=0; i < $inline_scripts.length; i++) {
    $inline_script_text = $inline_scripts[i].textContent.trim()

    if ($inline_script_text.indexOf('window.__data=') === 0) {
      // contains: \"referenceId\":\"

      state.episode.reference_id = find_needle({
        haystack: $inline_script_text,
        needle:   '\\"referenceId\\":\\"',
        tail:     '\\"',
        strict:   true
      })

      break
    }
  }

  if (!state.episode.reference_id) return

  download_episode_video_sources(function(video_sources) {
    var is_WM = (typeof GM_startIntent === 'function')
    var non_drm_video_data = null

    for (var i=0; i < video_sources.length; i++) {
      if (!video_sources[i].drm.scheme && !video_sources[i].drm.server) {
        non_drm_video_data = video_sources[i]
        break
      }
    }

    if (!non_drm_video_data || (is_WM && !user_options.webmonkey.post_intent_redirect_to_url)) {
      state.video_sources = video_sources
      reinitialize_dom()
    }

    if (non_drm_video_data) {
      process_video_data(non_drm_video_data)
    }
  })
}

// ----------------------------------------------------------------------------- bootstrap

var page_init = function() {
  page_init_livetv() || page_init_shows()
}

if (user_options.common.init_delay_ms)
  setTimeout(page_init, user_options.common.init_delay_ms)
else
  page_init()
