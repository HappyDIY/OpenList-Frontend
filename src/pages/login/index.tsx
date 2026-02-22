import {
  Image,
  Center,
  Flex,
  Heading,
  Text,
  Input,
  Button,
  useColorModeValue,
  HStack,
  VStack,
  Checkbox,
  Icon,
} from "@hope-ui/solid"
import { createMemo, createSignal, Show, onMount, onCleanup } from "solid-js"
import { SwitchColorMode, SwitchLanguageWhite } from "~/components"
import { useFetch, useT, useTitle, useRouter } from "~/hooks"
import {
  changeToken,
  r,
  notify,
  handleRespWithoutNotify,
  base_path,
  handleResp,
  hashPwd,
} from "~/utils"
import { PResp, Resp } from "~/types"
import LoginBg from "./LoginBg"
import { createStorageSignal } from "@solid-primitives/storage"
import { getSetting, getSettingBool } from "~/store"
import { SSOLogin } from "./SSOLogin"
import { IoFingerPrint } from "solid-icons/io"
import {
  parseRequestOptionsFromJSON,
  get,
  AuthenticationPublicKeyCredential,
  supported,
  CredentialRequestOptionsJSON,
} from "@github/webauthn-json/browser-ponyfill"

const Login = () => {
  const logos = getSetting("logo").split("\n")
  const logo = useColorModeValue(logos[0], logos.pop())
  const t = useT()
  const title = createMemo(() => {
    return `${t("login.login_to")} ${getSetting("site_title")}`
  })
  useTitle(title)
  const bgColor = useColorModeValue("white", "$neutral1")
  const [username, setUsername] = createSignal(
    localStorage.getItem("username") || "",
  )
  const [password, setPassword] = createSignal(
    localStorage.getItem("password") || "",
  )
  const [opt, setOpt] = createSignal("")
  const [usePasskey, setUsePasskey] = createSignal(false)
  const [passkeyNeedsUsername, setPasskeyNeedsUsername] = createSignal(false)
  const [remember, setRemember] = createStorageSignal("remember-pwd", "false")
  const [useLdap, setUseLdap] = createSignal(false)
  const [loading, data] = useFetch(
    async (): Promise<Resp<{ token: string }>> => {
      if (useLdap()) {
        return r.post("/auth/login/ldap", {
          username: username(),
          password: password(),
          otp_code: opt(),
        })
      } else {
        return r.post("/auth/login/hash", {
          username: username(),
          password: hashPwd(password()),
          otp_code: opt(),
        })
      }
    },
  )
  const [, postPasskeyLogin] = useFetch(
    (
      session: string,
      credentials: AuthenticationPublicKeyCredential,
      username: string,
      signal: AbortSignal | undefined,
    ): Promise<Resp<{ token: string }>> =>
      r.post(
        `/authn/passkey_finish_login${
          username ? `?username=${encodeURIComponent(username)}` : ""
        }`,
        JSON.stringify(credentials),
        {
          headers: {
            session: session,
          },
          signal,
        },
      ),
  )
  interface PasskeyTemp {
    session: string
    options: CredentialRequestOptionsJSON
    require_username?: boolean
  }
  interface LegacyAuthnStatus {
    has_legacy: boolean
  }
  const [, getPasskeyTemp] = useFetch(
    (
      username: string,
      allowCredentials: "yes" | "no",
      signal: AbortSignal | undefined,
    ): PResp<PasskeyTemp> => {
      const params = new URLSearchParams()
      params.set("allowCredentials", allowCredentials)
      if (username) {
        params.set("username", username)
      }
      return r.get(`/authn/passkey_begin_login?${params.toString()}`, {
        signal,
      })
    },
  )
  const [, getLegacyAuthnStatus] = useFetch(
    (signal: AbortSignal | undefined): PResp<LegacyAuthnStatus> =>
      r.get("/authn/passkey_legacy_status", {
        signal,
      }),
  )
  const { searchParams, to } = useRouter()
  const isAuthnConditionalAvailable = async (): Promise<boolean> => {
    if (
      PublicKeyCredential &&
      "isConditionalMediationAvailable" in PublicKeyCredential
    ) {
      // @ts-expect-error
      return await PublicKeyCredential.isConditionalMediationAvailable()
    } else {
      return false
    }
  }
  const passkeySignEnabled = true
  const passkeyAutoDisabled = "passkey-auto-login-disabled"
  const legacyPasskeyHintShown = "legacy-passkey-upgrade-tip-shown"
  const syncLegacyAuthnStatus = async (signal?: AbortSignal) => {
    const resp = await getLegacyAuthnStatus(signal)
    handleRespWithoutNotify(
      resp,
      (data) => {
        setPasskeyNeedsUsername(Boolean(data.has_legacy))
      },
      undefined,
      false,
    )
  }
  const AuthnSwitch = async () => {
    if (usePasskey()) {
      AuthnSignal?.abort()
      sessionStorage.setItem(passkeyAutoDisabled, "true")
      setUsePasskey(false)
      setPasskeyNeedsUsername(false)
      return
    }
    sessionStorage.removeItem(passkeyAutoDisabled)
    await syncLegacyAuthnStatus()
    setUsePasskey(true)
    if (!passkeyNeedsUsername()) {
      await AuthnLogin()
    }
  }
  let AuthnSignal: AbortController | null = null
  const AuthnLogin = async (conditional?: boolean) => {
    if (!supported()) {
      if (!conditional) {
        notify.error(t("users.webauthn_not_supported"))
      }
      return
    }
    if (conditional && !(await isAuthnConditionalAvailable())) {
      return
    }
    AuthnSignal?.abort()
    const controller = new AbortController()
    AuthnSignal = controller

    const continuePasskeyLogin = async (
      data: PasskeyTemp,
      usernameLogin: string,
    ) => {
      try {
        const options = parseRequestOptionsFromJSON(data.options)
        options.signal = controller.signal
        if (conditional) {
          // @ts-expect-error
          options.mediation = "conditional"
        }
        const credentials = await get(options)
        const resp = await postPasskeyLogin(
          data.session,
          credentials,
          usernameLogin,
          controller.signal,
        )
        handleRespWithoutNotify(resp, (data) => {
          if (
            usernameLogin &&
            !sessionStorage.getItem(legacyPasskeyHintShown)
          ) {
            notify.warning(t("login.passkey_legacy_upgrade_tip"))
            sessionStorage.setItem(legacyPasskeyHintShown, "true")
          }
          notify.success(t("login.success"))
          setPasskeyNeedsUsername(false)
          changeToken(data.token)
          to(
            decodeURIComponent(searchParams.redirect || base_path || "/"),
            true,
          )
        })
      } catch (error: unknown) {
        if (error instanceof Error && error.name != "AbortError")
          notify.error(error.message)
      }
    }

    const usernameLogin =
      !conditional && passkeyNeedsUsername() ? username().trim() : ""
    const allowCredentials: "yes" | "no" =
      !conditional && passkeyNeedsUsername() ? "yes" : "no"
    const resp = await getPasskeyTemp(
      usernameLogin,
      allowCredentials,
      controller.signal,
    )
    handleResp(resp, async (data) => {
      if (data.require_username && !usernameLogin) {
        setPasskeyNeedsUsername(true)
        return
      }
      setPasskeyNeedsUsername(Boolean(data.require_username))
      await continuePasskeyLogin(data, usernameLogin)
    })
  }
  const AuthnCleanUpHandler = () => AuthnSignal?.abort()
  onMount(() => {
    if (passkeySignEnabled) {
      window.addEventListener("beforeunload", AuthnCleanUpHandler)
      if (sessionStorage.getItem(passkeyAutoDisabled) === "true") return
      if (!supported()) return
      syncLegacyAuthnStatus().then(() => {
        if (passkeyNeedsUsername()) {
          setUsePasskey(true)
          return
        }
        isAuthnConditionalAvailable().then((available) => {
          if (!available) return
          setUsePasskey(true)
          AuthnLogin(true)
        })
      })
    }
  })
  onCleanup(() => {
    AuthnSignal?.abort()
    window.removeEventListener("beforeunload", AuthnCleanUpHandler)
  })

  const Login = async () => {
    if (!usePasskey()) {
      if (remember() === "true") {
        localStorage.setItem("username", username())
        localStorage.setItem("password", password())
      } else {
        localStorage.removeItem("username")
        localStorage.removeItem("password")
      }
      const resp = await data()
      handleRespWithoutNotify(
        resp,
        (data) => {
          notify.success(t("login.success"))
          changeToken(data.token)
          to(
            decodeURIComponent(searchParams.redirect || base_path || "/"),
            true,
          )
        },
        (msg, code) => {
          if (!needOpt() && code === 402) {
            setNeedOpt(true)
          } else {
            notify.error(msg)
          }
        },
      )
    } else {
      await AuthnLogin()
    }
  }
  const [needOpt, setNeedOpt] = createSignal(false)
  const ldapLoginEnabled = getSettingBool("ldap_login_enabled")
  const ldapLoginTips = getSetting("ldap_login_tips")
  if (ldapLoginEnabled) {
    setUseLdap(true)
  }

  return (
    <Center zIndex="1" w="$full" h="100vh">
      <VStack
        bgColor={bgColor()}
        rounded="$xl"
        p="24px"
        w={{
          "@initial": "90%",
          "@sm": "364px",
        }}
        spacing="$4"
      >
        <Flex alignItems="center" justifyContent="space-around">
          <Image mr="$2" boxSize="$12" src={logo()} />
          <Heading color="$info9" fontSize="$2xl">
            {title()}
          </Heading>
        </Flex>
        <Show
          when={!needOpt()}
          fallback={
            <Input
              id="totp"
              name="otp"
              placeholder={t("login.otp-tips")}
              value={opt()}
              onInput={(e) => setOpt(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  Login()
                }
              }}
            />
          }
        >
          <Show when={!usePasskey() || passkeyNeedsUsername()}>
            <Input
              name="username"
              placeholder={
                usePasskey()
                  ? t("login.passkey_input_username")
                  : t("login.username-tips")
              }
              value={username()}
              onInput={(e) => setUsername(e.currentTarget.value)}
            />
          </Show>
          <Show when={!usePasskey()}>
            <Input
              name="password"
              placeholder={t("login.password-tips")}
              type="password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  Login()
                }
              }}
            />
          </Show>
          <Show when={!usePasskey()}>
            <Flex
              px="$1"
              w="$full"
              fontSize="$sm"
              color="$neutral10"
              justifyContent="space-between"
              alignItems="center"
            >
              <Checkbox
                checked={remember() === "true"}
                onChange={() =>
                  setRemember(remember() === "true" ? "false" : "true")
                }
              >
                {t("login.remember")}
              </Checkbox>
              <Text as="a" target="_blank" href={t("login.forget_url")}>
                {t("login.forget")}
              </Text>
            </Flex>
          </Show>
        </Show>
        <HStack w="$full" spacing="$2">
          <Show when={!usePasskey()}>
            <Button
              colorScheme="primary"
              w="$full"
              onClick={() => {
                if (needOpt()) {
                  setOpt("")
                } else {
                  setUsername("")
                  setPassword("")
                }
              }}
            >
              {t("login.clear")}
            </Button>
          </Show>
          <Button w="$full" loading={loading()} onClick={Login}>
            {usePasskey() ? t("login.continue_with_passkey") : t("login.login")}
          </Button>
        </HStack>
        <Show when={ldapLoginEnabled}>
          <Checkbox
            w="$full"
            checked={useLdap() === true}
            onChange={() => setUseLdap(!useLdap())}
          >
            {ldapLoginTips}
          </Checkbox>
        </Show>
        <Button
          w="$full"
          colorScheme="accent"
          onClick={() => {
            changeToken()
            to(
              decodeURIComponent(searchParams.redirect || base_path || "/"),
              true,
            )
          }}
        >
          {t("login.use_guest")}
        </Button>
        <Flex
          mt="$2"
          justifyContent="space-evenly"
          alignItems="center"
          color="$neutral10"
          w="$full"
        >
          <SwitchLanguageWhite />
          <SwitchColorMode />
          <SSOLogin />
          <Show when={passkeySignEnabled}>
            <Icon
              cursor="pointer"
              boxSize="$8"
              as={IoFingerPrint}
              p="$0_5"
              onclick={AuthnSwitch}
            />
          </Show>
        </Flex>
      </VStack>
      <LoginBg />
    </Center>
  )
}

export default Login
