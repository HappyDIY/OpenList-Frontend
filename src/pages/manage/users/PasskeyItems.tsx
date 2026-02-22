import { Button, HStack, Text, VStack } from "@hope-ui/solid"
import { createSignal, Show } from "solid-js"
import { useFetch, useT } from "~/hooks"
import { PEmptyResp, PResp } from "~/types"
import { handleResp, notify, r } from "~/utils"
import {
  RegistrationPublicKeyCredential,
  create,
  parseCreationOptionsFromJSON,
  supported,
  CredentialCreationOptionsJSON,
} from "@github/webauthn-json/browser-ponyfill"

interface PasskeyItemProps {
  id: string
  fingerprint: string
  creator_ip?: string
  creator_ua?: string
  is_legacy?: boolean
  onDeleted?: () => void
}

interface PasskeyTemp {
  session: string
  options: CredentialCreationOptionsJSON
}

export const PasskeyItem = (props: PasskeyItemProps) => {
  const t = useT()
  const [deleted, setDeleted] = createSignal(false)
  const [upgrading, setUpgrading] = createSignal(false)
  const [deleting, remove] = useFetch(
    (): PEmptyResp =>
      r.post("/authn/delete_authn", {
        id: props.id,
      }),
  )
  const [, getauthntemp] = useFetch(
    (): PResp<PasskeyTemp> =>
      r.get("/authn/passkey_begin_registration?upgrade=yes"),
  )
  const [, postregistration] = useFetch(
    (
      session: string,
      credentials: RegistrationPublicKeyCredential,
    ): PEmptyResp =>
      r.post(
        "/authn/passkey_finish_registration",
        JSON.stringify(credentials),
        {
          headers: {
            session,
          },
        },
      ),
  )

  const upgradeToPasskey = async () => {
    if (!supported()) {
      notify.error(t("users.webauthn_not_supported"))
      return
    }
    setUpgrading(true)
    try {
      const beginResp = await getauthntemp()
      handleResp(beginResp, async (beginData) => {
        const options = parseCreationOptionsFromJSON(beginData.options)
        try {
          const browserresponse = await create(options)
          const finishResp = await postregistration(
            beginData.session,
            browserresponse,
          )
          handleResp(finishResp, async () => {
            const deleteResp = await remove()
            handleResp(
              deleteResp,
              () => {
                notify.success(t("users.upgrade_to_passkey_success"))
                setDeleted(true)
                props.onDeleted?.()
              },
              () => {
                notify.warning(t("users.upgrade_to_passkey_keep_old"))
                props.onDeleted?.()
              },
            )
          })
        } catch (error: unknown) {
          if (error instanceof Error) notify.error(error.message)
        }
      })
    } finally {
      setUpgrading(false)
    }
  }

  return (
    <Show when={!deleted()}>
      <VStack
        alignItems="start"
        minW={{ "@initial": "100%", "@sm": "420px" }}
        p="$3"
        rounded="$md"
        borderWidth="1px"
        borderColor="$neutral6"
        gap="$2"
      >
        <Text fontWeight="$semibold">{props.fingerprint}</Text>
        <Text size="sm" wordBreak="break-all">
          {t("users.webauthn_creator_ip")}:{" "}
          {props.creator_ip || t("users.unknown")}
        </Text>
        <Text size="sm" wordBreak="break-word">
          {t("users.webauthn_creator_ua")}:{" "}
          {props.creator_ua || t("users.unknown")}
        </Text>
        <HStack w="$full" justifyContent="end">
          <Show when={props.is_legacy}>
            <Button
              size="sm"
              colorScheme="accent"
              loading={upgrading()}
              onClick={upgradeToPasskey}
            >
              {t("users.update_to_passkey")}
            </Button>
          </Show>
          <Button
            size="sm"
            colorScheme="danger"
            loading={deleting()}
            onClick={async () => {
              const resp = await remove()
              handleResp(resp, () => {
                notify.success(t("global.delete_success"))
                setDeleted(true)
                props.onDeleted?.()
              })
            }}
          >
            {t("global.delete")}
          </Button>
        </HStack>
      </VStack>
    </Show>
  )
}
