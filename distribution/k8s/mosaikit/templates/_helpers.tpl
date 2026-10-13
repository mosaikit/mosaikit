{{- define "mosaikit.fullname" -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "mosaikit.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/*
The environment variable of a setting (MK-129): the name of the setting in upper case, with every
character that is not a letter or a digit replaced by "_", as the kernel reads it. The value is a
string, a number or a boolean, or a map with valueFrom (secretKeyRef or configMapKeyRef), so that a
secret value stays in a Secret and never in the values of the chart.
Takes a dict: name, value, and where (the values that hold it, for messages).
*/}}
{{- define "mosaikit.settingEnv" -}}
{{- $name := toString .name -}}
{{- if not (regexMatch "^[A-Za-z0-9][A-Za-z0-9._\"-]*$" $name) -}}
{{- fail (printf "%s: %q is not the name of a setting, such as example.reports.endpoint" .where $name) -}}
{{- end -}}
{{- $value := .value -}}
- name: {{ regexReplaceAll "[^A-Za-z0-9]" $name "_" | upper }}
{{- if kindIs "map" $value }}
{{- $from := required (printf "%s: %s is a map without valueFrom; write a value, or valueFrom with secretKeyRef or configMapKeyRef" .where $name) $value.valueFrom }}
{{- if not (or (hasKey $from "secretKeyRef") (hasKey $from "configMapKeyRef")) }}
{{- fail (printf "%s: the valueFrom of %s takes secretKeyRef or configMapKeyRef" .where $name) }}
{{- end }}
  valueFrom:
    {{- toYaml $from | nindent 4 }}
{{- else if or (kindIs "invalid" $value) (kindIs "slice" $value) }}
{{- fail (printf "%s: %s needs a value, or valueFrom with secretKeyRef or configMapKeyRef" .where $name) }}
{{- else }}
  value: {{ toString $value | quote }}
{{- end }}
{{- end -}}

{{/*
The environment variables of the settings that the chart does not name (MK-129): kernel.extraSettings,
then the settings of each extension, by identifier, then kernel.extraEnv. They come after the
variables of the chart, so a setting given twice takes the value given here.
*/}}
{{- define "mosaikit.extraEnv" -}}
{{- range $name, $value := .Values.kernel.extraSettings }}
{{ include "mosaikit.settingEnv" (dict "name" $name "value" $value "where" "kernel.extraSettings") }}
{{- end }}
{{- range $id, $extension := .Values.extensions }}
{{- if and (kindIs "map" $extension) (hasKey $extension "settings") }}
{{- range $name, $value := $extension.settings }}
{{ include "mosaikit.settingEnv" (dict "name" $name "value" $value "where" (printf "extensions.%s.settings" $id)) }}
{{- end }}
{{- end }}
{{- end }}
{{- with .Values.kernel.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "mosaikit.selectorLabels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
