import { colors } from "./ui";
import imagePolicy from "../shared/notificationImagePolicy.json";
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, Linking, Image, Pressable } from "react-native";
import RenderHTML, {
  HTMLElementModel,
  HTMLContentModel,
  type CustomBlockRenderer,
} from "@native-html/render";
import { documentToHtml } from "../shared/notificationContent";
import type { RichNode } from "./notificationTypes";
import { getNotificationImage } from "./api";
import { currentConnectivity, observeConnectivity } from "./connectivity";

// Private images are fetched with the current session and retained only in mounted
// component memory. No bearer credentials in URLs and no persistent image cache.
function PrivateImage({
  notificationId,
  mediaId,
  width,
  alt,
}: {
  notificationId: string;
  mediaId: string;
  width: number;
  alt: string;
}) {
  const [online, setOnline] = useState(currentConnectivity() === "online");
  const [image, setImage] = useState<{ uri: string; ratio: number } | null>(
    null,
  );
  const [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  useEffect(() => observeConnectivity((s) => setOnline(s === "online")), []);
  useEffect(() => {
    let active = true;
    setImage(null);
    setFailed(false);
    if (online && /^[a-f\d]{24}$/i.test(mediaId))
      void getNotificationImage(notificationId, mediaId)
        .then((r) => {
          if (
            r.contentType !== "image/webp" ||
            !r.width ||
            !r.height ||
            r.data.length > 2800000
          )
            throw Error("Invalid image");
          if (active)
            setImage({
              uri: `data:image/webp;base64,${r.data}`,
              ratio: r.width / r.height,
            });
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    return () => {
      active = false;
    };
  }, [online, notificationId, mediaId, retry]);
  if (!online)
    return (
      <Text style={{ padding: 12 }}>
        Image available when online{alt ? `: ${alt}` : ""}.
      </Text>
    );
  if (failed)
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setRetry((n) => n + 1)}
      >
        <Text style={{ padding: 12 }}>Image unavailable. Tap to retry.</Text>
      </Pressable>
    );
  return image ? (
    <Image
      accessible
      accessibilityLabel={alt || "Notification image"}
      source={{ uri: image.uri }}
      resizeMode="contain"
      style={{ width, aspectRatio: image.ratio, maxWidth: "100%" }}
      onError={() => {
        setImage(null);
        setFailed(true);
      }}
    />
  ) : (
    <Text style={{ padding: 12 }}>Loading image…</Text>
  );
}
function EmbeddedImage({
  uri,
  width,
  height,
  imageWidth,
  alt,
}: {
  uri: string;
  width: number;
  height: number;
  imageWidth: number;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  const valid =
    uri.length <= imagePolicy.imageDataBytes &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(uri) &&
    width > 0 &&
    height > 0 &&
    width <= imagePolicy.maxDimension &&
    height <= imagePolicy.maxDimension;
  if (!valid || failed)
    return <Text>Image unavailable{alt ? `: ${alt}` : ""}.</Text>;
  return (
    <Image
      accessibilityLabel={alt || "Notification image"}
      source={{ uri }}
      resizeMode="contain"
      style={{
        width: imageWidth,
        aspectRatio: width / height,
        maxWidth: "100%",
      }}
      onError={() => setFailed(true)}
    />
  );
}
const models = Object.fromEntries(
  ["table", "thead", "tbody", "tr", "td", "th"].map((tagName) => [
    tagName,
    HTMLElementModel.fromCustomModel({
      tagName,
      contentModel: HTMLContentModel.block,
    }),
  ]),
);
export function NotificationContent({
  document,
  notificationId,
}: {
  document?: RichNode;
  notificationId: string;
}) {
  const [width, setWidth] = useState(280);
  const renderers = useMemo(() => {
    const img: CustomBlockRenderer = ({ tnode }) => (
      <View
        style={{
          alignItems:
            tnode.attributes["data-align"] === "right"
              ? "flex-end"
              : tnode.attributes["data-align"] === "center"
                ? "center"
                : "flex-start",
        }}
      >
        {tnode.attributes.src?.startsWith("data:") ? (
          <EmbeddedImage
            uri={tnode.attributes.src}
            alt={tnode.attributes.alt || ""}
            width={Number(tnode.attributes.width)}
            height={Number(tnode.attributes.height)}
            imageWidth={
              (width *
                Math.min(
                  100,
                  Math.max(
                    10,
                    Number(tnode.attributes["data-width-percent"]) || 100,
                  ),
                )) /
              100
            }
          />
        ) : (
          <PrivateImage
            notificationId={notificationId}
            mediaId={tnode.attributes.src || ""}
            alt={tnode.attributes.alt || ""}
            width={
              (width *
                Math.min(
                  100,
                  Math.max(
                    10,
                    Number(tnode.attributes["data-width-percent"]) || 100,
                  ),
                )) /
              100
            }
          />
        )}
      </View>
    );
    return { img };
  }, [notificationId, width]);
  const source = useMemo(
    () => ({ html: document ? documentToHtml(document, (id) => id) : "" }),
    [document],
  );
  return (
    <View onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))}>
      <RenderHTML
        contentWidth={width}
        source={source}
        renderers={renderers}
        customHTMLElementModels={models}
        baseStyle={{ fontSize: 16, lineHeight: 26, color: colors.dark }}
        defaultTextProps={{ selectable: true }}
        tagsStyles={{
          p: { marginTop: 0, marginBottom: 16 },
          h1: { fontSize: 26, lineHeight: 34, fontWeight: "700", marginTop: 12, marginBottom: 16 },
          h2: { fontSize: 22, lineHeight: 30, fontWeight: "700", marginTop: 12, marginBottom: 14 },
          h3: { fontSize: 19, lineHeight: 28, fontWeight: "600", marginTop: 10, marginBottom: 12 },
          ul: { paddingLeft: 24, marginTop: 0, marginBottom: 16 },
          ol: { paddingLeft: 24, marginTop: 0, marginBottom: 16 },
          li: { marginBottom: 6 },
          a: { color: colors.blue, textDecorationLine: "underline" },
          blockquote: { marginHorizontal: 0, marginVertical: 12, paddingLeft: 16, borderLeftWidth: 3, borderLeftColor: colors.border },
          figure: { marginHorizontal: 0, marginVertical: 12, maxWidth: "100%" },
          table: { borderWidth: 1, borderColor: colors.border, marginBottom: 16, maxWidth: "100%" },
          tr: { flexDirection: "row", borderBottomWidth: 1, borderColor: colors.border },
          td: { padding: 8, flexGrow: 1, flexBasis: 0, minWidth: 0 },
          th: { padding: 8, flexGrow: 1, flexBasis: 0, minWidth: 0, fontWeight: "700", backgroundColor: colors.pale },
        }}
        renderersProps={{
          a: {
            onPress: (_, href) => {
              if (/^https?:\/\//i.test(href))
                void Linking.openURL(href).catch(() => {});
            },
          },
        }}
      />
    </View>
  );
}
