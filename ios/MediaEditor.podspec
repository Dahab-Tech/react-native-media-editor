Pod::Spec.new do |s|
  s.name           = 'MediaEditor'
  s.version        = '0.3.1'
  s.summary        = 'Customizable photo & video editor for Expo / React Native with RTL support'
  s.description    = 'Photo editor with crop, filters, adjustments, text, stickers, draw, focus, and overlays; video editor with trim, crop, cover, filters, and speed. RTL built in.'
  s.author         = 'DahabTech LLC <dahabtech.llc@gmail.com>'
  s.homepage       = 'https://dahab-tech.com/apps/react-native-media-editor'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: 'https://github.com/Dahab-Tech/react-native-media-editor.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
